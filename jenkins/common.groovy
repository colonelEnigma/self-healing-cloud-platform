def podYaml() {
  return '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins-deployer
  volumes:
    - name: shared-auth
      emptyDir: {}
  containers:
    - name: devops
      image: 348071628290.dkr.ecr.ap-south-1.amazonaws.com/jenkins-agent-devops:latest
      command:
        - cat
      tty: true
      volumeMounts:
        - name: shared-auth
          mountPath: /shared-auth

    - name: buildah
      image: quay.io/buildah/stable:latest
      command:
        - cat
      tty: true
      securityContext:
        privileged: true
      volumeMounts:
        - name: shared-auth
          mountPath: /shared-auth
'''
}

def serviceConfigs() {
  return [
    'user-service': [
      serviceName   : 'user-service',
      awsRegion     : 'ap-south-1',
      ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
      ecrRepository : 'user-service',
      servicePath   : 'services/user-service',
      k8sPath       : 'k8s/user-service',
      deploymentFile: 'deployment.yml',
      serviceFile   : 'service.yml',
      kafkaAware    : false
    ],
    'order-service': [
      serviceName   : 'order-service',
      awsRegion     : 'ap-south-1',
      ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
      ecrRepository : 'order-service',
      servicePath   : 'services/order-service',
      k8sPath       : 'k8s/order-service',
      deploymentFile: 'deployment.yml',
      serviceFile   : 'service.yml',
      kafkaAware    : true
    ],
    'payment-service': [
      serviceName   : 'payment-service',
      awsRegion     : 'ap-south-1',
      ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
      ecrRepository : 'payment-service',
      servicePath   : 'services/payment-service',
      k8sPath       : 'k8s/payment-service',
      deploymentFile: 'deployment.yaml',
      serviceFile   : 'service.yaml',
      kafkaAware    : true
    ],
    'product-service': [
      serviceName   : 'product-service',
      awsRegion     : 'ap-south-1',
      ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
      ecrRepository : 'product-service',
      servicePath   : 'services/product-service',
      k8sPath       : 'k8s/product-service',
      deploymentFile: 'deployment.yml',
      serviceFile   : 'service.yml',
      kafkaAware    : true
    ],
    'search-service': [
      serviceName   : 'search-service',
      awsRegion     : 'ap-south-1',
      ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
      ecrRepository : 'search-service',
      servicePath   : 'services/search-service',
      k8sPath       : 'k8s/search-service',
      deploymentFile: 'deployment.yaml',
      serviceFile   : 'service.yaml',
      kafkaAware    : true
    ]
  ]
}

def configForService(String serviceName) {
  def cfg = serviceConfigs()[serviceName]
  if (!cfg) {
    throw new IllegalArgumentException("Unsupported service for Jenkins deployment: ${serviceName}")
  }
  return cfg
}

def runNamedService(scriptRef, String serviceName) {
  runService(scriptRef, configForService(serviceName))
}

def runService(scriptRef, Map cfg) {
  scriptRef.podTemplate(yaml: podYaml(), defaultContainer: 'devops') {
    scriptRef.node(scriptRef.POD_LABEL) {

      scriptRef.stage("${cfg.serviceName} - Prepare Git") {
        scriptRef.container('devops') {
          scriptRef.sh 'git config --global --add safe.directory "*"'
          scriptRef.checkout scriptRef.scm
          scriptRef.script {
            scriptRef.env.IMAGE_TAG = scriptRef.sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          }
        }
      }

      scriptRef.stage("${cfg.serviceName} - Login to ECR") {
        scriptRef.container('devops') {
          scriptRef.withCredentials([
            scriptRef.string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'),
            scriptRef.string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')
          ]) {
            scriptRef.sh """
              mkdir -p /shared-auth
              aws ecr get-login-password --region ${cfg.awsRegion} > /shared-auth/ecr-password
            """
          }
        }
      }

      scriptRef.stage("${cfg.serviceName} - Build and Push") {
        scriptRef.container('buildah') {
          scriptRef.sh """
            export REGISTRY_AUTH_FILE=/tmp/auth.json
            cat /shared-auth/ecr-password | buildah login --username AWS --password-stdin ${cfg.ecrRegistry}

            buildah bud \
              -t ${cfg.ecrRegistry}/${cfg.ecrRepository}:${scriptRef.env.IMAGE_TAG} \
              ${cfg.servicePath}

            buildah push \
              ${cfg.ecrRegistry}/${cfg.ecrRepository}:${scriptRef.env.IMAGE_TAG}
          """
        }
      }

      scriptRef.stage("${cfg.serviceName} - Deploy to dev") {
        scriptRef.container('devops') {
          deployEnv(scriptRef, cfg, 'dev', scriptRef.env.IMAGE_TAG)
        }
      }

      scriptRef.stage("${cfg.serviceName} - Deploy to test") {
        scriptRef.container('devops') {
          deployEnv(scriptRef, cfg, 'test', scriptRef.env.IMAGE_TAG)
        }
      }
    }
  }
}

def promoteService(scriptRef, String serviceName, String targetEnv, String imageTag) {
  def cfg = configForService(serviceName)
  def allowedEnvs = ['prod']
  if (!allowedEnvs.contains(targetEnv)) {
    scriptRef.error("Promotion target must be prod; got '${targetEnv}'. Dev and test deploy automatically from normal service changes.")
  }

  if (!(imageTag ==~ /^[A-Za-z0-9_.-]+$/)) {
    scriptRef.error("Invalid promotion image tag '${imageTag}'.")
  }

  def expectedImage = "${cfg.ecrRegistry}/${cfg.ecrRepository}:${imageTag}"
  def currentImage = scriptRef.sh(
    script: """kubectl get deployment/${cfg.serviceName} -n ${targetEnv} -o jsonpath='{.spec.template.spec.containers[?(@.name=="${cfg.serviceName}")].image}' 2>/dev/null || true""",
    returnStdout: true
  ).trim()

  scriptRef.echo "Promotion request: ${cfg.serviceName} -> ${targetEnv} using ${expectedImage}"

  if (currentImage == expectedImage) {
    scriptRef.echo "Deployment already runs the requested image. Verifying rollout without reapplying manifests."
    scriptRef.sh """
      kubectl rollout status deployment/${cfg.serviceName} -n ${targetEnv}
      kubectl get pods -n ${targetEnv}
    """
    return
  }

  deployEnv(scriptRef, cfg, targetEnv, imageTag)
  scriptRef.sh "kubectl get pods -n ${targetEnv}"
}

def deployEnv(scriptRef, Map cfg, String targetEnv, String imageTag) {
  def allowedEnvs = ['dev', 'test', 'prod']
  if (!allowedEnvs.contains(targetEnv)) {
    scriptRef.error("Deployment target must be one of ${allowedEnvs}; got '${targetEnv}'.")
  }

  def topic = ''
  def dlq = ''
  def group = ''

  if (cfg.kafkaAware) {
    if (targetEnv == 'dev') {
      topic = 'order_created_dev'
      dlq   = 'order_created_dlq_dev'

      if (cfg.serviceName == 'payment-service') {
        group = 'payment-group-dev'
      } else if (cfg.serviceName == 'search-service') {
        group = 'search-group-dev'
      } else if (cfg.serviceName == 'product-service') {
        group = 'product-group-dev'
      }
    } else if (targetEnv == 'test') {
      topic = 'order_created_test'
      dlq   = 'order_created_dlq_test'

      if (cfg.serviceName == 'payment-service') {
        group = 'payment-group-test'
      } else if (cfg.serviceName == 'search-service') {
        group = 'search-group-test'
      } else if (cfg.serviceName == 'product-service') {
        group = 'product-group-test'
      }
    } else {
      topic = 'order_created'
      dlq   = 'order_created_dlq'

      if (cfg.serviceName == 'payment-service') {
        group = 'payment-group'
      } else if (cfg.serviceName == 'search-service') {
        group = 'search-group'
      } else if (cfg.serviceName == 'product-service') {
        group = 'product-group'
      }
    }
  }

  if (cfg.kafkaAware) {
    scriptRef.sh """
      sed \
        -e 's|\\\${NAMESPACE}|${targetEnv}|g' \
        -e 's|\\\${IMAGE_TAG}|${imageTag}|g' \
        -e 's|\\\${ORDER_CREATED_TOPIC}|${topic}|g' \
        -e 's|\\\${ORDER_CREATED_DLQ_TOPIC}|${dlq}|g' \
        -e 's|\\\${KAFKA_CONSUMER_GROUP}|${group}|g' \
        ${cfg.k8sPath}/${cfg.deploymentFile} | kubectl apply -f -

      sed \
        -e 's|\\\${NAMESPACE}|${targetEnv}|g' \
        ${cfg.k8sPath}/${cfg.serviceFile} | kubectl apply -f -

      kubectl rollout status deployment/${cfg.serviceName} -n ${targetEnv}
    """
  } else {
    scriptRef.sh """
      sed \
        -e 's|\\\${NAMESPACE}|${targetEnv}|g' \
        -e 's|\\\${IMAGE_TAG}|${imageTag}|g' \
        ${cfg.k8sPath}/${cfg.deploymentFile} | kubectl apply -f -

      sed \
        -e 's|\\\${NAMESPACE}|${targetEnv}|g' \
        ${cfg.k8sPath}/${cfg.serviceFile} | kubectl apply -f -

      kubectl rollout status deployment/${cfg.serviceName} -n ${targetEnv}
    """
  }
}

return this
