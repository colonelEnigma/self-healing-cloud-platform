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

      scriptRef.stage("${cfg.serviceName} - Deploy to prod") {
        scriptRef.container('devops') {
          deployEnv(scriptRef, cfg, 'prod', scriptRef.env.IMAGE_TAG)
        }
      }
    }
  }
}

def deployEnv(scriptRef, Map cfg, String targetEnv, String imageTag) {
  def topic = ''
  def dlq = ''

  if (cfg.kafkaAware) {
    if (targetEnv == 'dev') {
      topic = 'order_created_dev'
      dlq   = 'order_created_dlq_dev'
    } else if (targetEnv == 'test') {
      topic = 'order_created_test'
      dlq   = 'order_created_dlq_test'
    } else {
      topic = 'order_created'
      dlq   = 'order_created_dlq'
    }
  }

  def deploymentCmd = """
    sed \
      -e 's|\\\${NAMESPACE}|${targetEnv}|g' \
      -e 's|\\\${IMAGE_TAG}|${imageTag}|g'
  """

  if (cfg.kafkaAware) {
    deploymentCmd += """
      -e 's|\\\${ORDER_CREATED_TOPIC}|${topic}|g' \
      -e 's|\\\${ORDER_CREATED_DLQ_TOPIC}|${dlq}|g'
    """
  }

  deploymentCmd += """
      ${cfg.k8sPath}/${cfg.deploymentFile} | kubectl apply -f -
  """

  scriptRef.sh deploymentCmd

  scriptRef.sh """
    sed \
      -e 's|\\\${NAMESPACE}|${targetEnv}|g' \
      ${cfg.k8sPath}/${cfg.serviceFile} | kubectl apply -f -

    kubectl rollout status deployment/${cfg.serviceName} -n ${targetEnv}
  """
}

return this