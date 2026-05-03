pipeline {
  agent none

  options {
    disableConcurrentBuilds()
  }

  stages {
    stage('Checkout') {
      agent {
        kubernetes {
          defaultContainer 'devops'
          yaml '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins-deployer
  containers:
    - name: devops
      image: 348071628290.dkr.ecr.ap-south-1.amazonaws.com/jenkins-agent-devops:latest
      command:
        - cat
      tty: true
'''
        }
      }
      steps {
        checkout scm
      }
    }

    stage('Detect Changed Services') {
      agent {
        kubernetes {
          defaultContainer 'devops'
          yaml '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins-deployer
  containers:
    - name: devops
      image: 348071628290.dkr.ecr.ap-south-1.amazonaws.com/jenkins-agent-devops:latest
      command:
        - cat
      tty: true
'''
        }
      }
      steps {
        checkout scm
        script {
          def currentCommit = sh(
            script: 'git rev-parse HEAD',
            returnStdout: true
          ).trim()
          def currentShortCommit = sh(
            script: 'git rev-parse --short HEAD',
            returnStdout: true
          ).trim()

          def previousSuccessfulCommit = env.GIT_PREVIOUS_SUCCESSFUL_COMMIT ?: ''
          def diffBase = previousSuccessfulCommit?.trim() ? previousSuccessfulCommit.trim() : 'HEAD~1'
          def diffCommand = previousSuccessfulCommit?.trim() == currentCommit ? 'true' : "git diff --name-only ${diffBase} HEAD || true"
          def changedFilesRaw = sh(
            script: diffCommand,
            returnStdout: true
          ).trim()

          def changedFiles = changedFilesRaw ? changedFilesRaw.split('\n') : []
          env.CURRENT_COMMIT = currentCommit
          env.CURRENT_SHORT_COMMIT = currentShortCommit
          env.DIFF_BASE_COMMIT = diffBase

          env.ROLLBACK_FILE_CHANGED = changedFiles.contains('jenkins/rollback.env') ? 'true' : 'false'
          env.PROMOTION_FILE_CHANGED = changedFiles.contains('jenkins/promotion.env') ? 'true' : 'false'
          env.IS_ROLLBACK = 'false'
          env.IS_PROMOTION = 'false'
          env.ROLLBACK_SERVICE = ''
          env.ROLLBACK_NAMESPACE = ''
          env.ROLLBACK_IMAGE_TAG = ''
          env.PROMOTE_NAMESPACE = ''
          env.PROMOTE_SERVICES = ''
          env.PROMOTION_PLAN = ''
          env.PROMOTION_MODE = ''

          def parseEnvFile = { filePath ->
            def cfg = [:]
            readFile(filePath).trim().split('\n').each { line ->
              line = line.trim()
              if (line && !line.startsWith('#') && line.contains('=')) {
                def parts = line.split('=', 2)
                cfg[parts[0].trim()] = parts[1].trim()
              }
            }
            return cfg
          }

          if (env.ROLLBACK_FILE_CHANGED == 'true' && fileExists('jenkins/rollback.env')) {
            def rollbackCfg = parseEnvFile('jenkins/rollback.env')

            env.ACTION_VALUE           = rollbackCfg['ACTION'] ?: ''
            env.ROLLBACK_SERVICE       = rollbackCfg['ROLLBACK_SERVICE'] ?: ''
            env.ROLLBACK_NAMESPACE     = rollbackCfg['ROLLBACK_NAMESPACE'] ?: ''
            env.ROLLBACK_IMAGE_TAG     = rollbackCfg['ROLLBACK_IMAGE_TAG'] ?: ''
            env.CONFIRM_ROLLBACK_VALUE = rollbackCfg['CONFIRM_ROLLBACK'] ?: ''

            if (
              env.ACTION_VALUE == 'rollback' &&
              env.CONFIRM_ROLLBACK_VALUE == 'true' &&
              env.ROLLBACK_SERVICE?.trim() &&
              env.ROLLBACK_NAMESPACE?.trim() &&
              env.ROLLBACK_IMAGE_TAG?.trim()
            ) {
              env.IS_ROLLBACK = 'true'
            }
          }

          if (env.PROMOTION_FILE_CHANGED == 'true' && fileExists('jenkins/promotion.env')) {
            def promotionCfg = parseEnvFile('jenkins/promotion.env')
            def allowedPromotionServices = [
              'user-service',
              'order-service',
              'payment-service',
              'product-service',
              'search-service'
            ]

            env.PROMOTION_ACTION_VALUE   = promotionCfg['ACTION'] ?: ''
            env.PROMOTE_NAMESPACE        = promotionCfg['PROMOTE_NAMESPACE'] ?: ''
            env.PROMOTE_SERVICES         = promotionCfg['PROMOTE_SERVICES'] ?: ''
            env.CONFIRM_PROMOTION_VALUE  = promotionCfg['CONFIRM_PROMOTION'] ?: ''

            if (
              env.PROMOTION_ACTION_VALUE == 'promote' &&
              env.CONFIRM_PROMOTION_VALUE == 'true' &&
              env.PROMOTE_NAMESPACE?.trim()
            ) {
              if (env.PROMOTE_NAMESPACE != 'prod') {
                error "Promotion target must be prod; got '${env.PROMOTE_NAMESPACE}'."
              }

              if (env.PROMOTE_SERVICES?.trim()) {
                def requestedServices = env.PROMOTE_SERVICES.split(/\s*,\s*/).collect { it.trim() }.findAll { it }
                requestedServices.each { service ->
                  if (service.contains(':')) {
                    error "PROMOTE_SERVICES now accepts service names only, not tags. Invalid entry: '${service}'"
                  }
                  if (!allowedPromotionServices.contains(service)) {
                    error "Unsupported promotion service in PROMOTE_SERVICES: '${service}'"
                  }
                }
                env.PROMOTE_SERVICES = requestedServices.join(',')
              }

              env.PROMOTION_MODE = 'promote-dev-images-to-prod'
              env.IS_PROMOTION = 'true'
            }
          }

          if (env.IS_ROLLBACK == 'true' && env.IS_PROMOTION == 'true') {
            error 'Only one of jenkins/rollback.env or jenkins/promotion.env may contain a confirmed action in a single commit.'
          }

          if (env.IS_ROLLBACK == 'true' || env.IS_PROMOTION == 'true') {
            env.RUN_USER = 'false'
            env.RUN_ORDER = 'false'
            env.RUN_PRODUCT = 'false'
            env.RUN_PAYMENT = 'false'
            env.RUN_SEARCH = 'false'
            env.RUN_CONTROL_PLANE = 'false'
          } else {
            env.RUN_USER = (
              changedFiles.any {
                it.startsWith('services/user-service/') ||
                it.startsWith('k8s/user-service/') ||
                it == 'jenkins/user-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_ORDER = (
              changedFiles.any {
                it.startsWith('services/order-service/') ||
                it.startsWith('k8s/order-service/') ||
                it == 'jenkins/order-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_PRODUCT = (
              changedFiles.any {
                it.startsWith('services/product-service/') ||
                it.startsWith('k8s/product-service/') ||
                it == 'jenkins/product-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_PAYMENT = (
              changedFiles.any {
                it.startsWith('services/payment-service/') ||
                it.startsWith('k8s/payment-service/') ||
                it == 'jenkins/payment-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_SEARCH = (
              changedFiles.any {
                it.startsWith('services/search-service/') ||
                it.startsWith('k8s/search-service/') ||
                it == 'jenkins/search-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_CONTROL_PLANE = (
              changedFiles.any {
                it.startsWith('services/control-plane-service/') ||
                it.startsWith('k8s/control-plane-service/') ||
                it == 'k8s/ingress/control-plane-monitoring-ingress.yaml' ||
                it == 'jenkins/control-plane-service.groovy'
              }
            ) ? 'true' : 'false'
          }

          echo "Changed files: ${changedFiles}"
          echo "CURRENT_COMMIT=${env.CURRENT_COMMIT}"
          echo "CURRENT_SHORT_COMMIT=${env.CURRENT_SHORT_COMMIT}"
          echo "DIFF_BASE_COMMIT=${env.DIFF_BASE_COMMIT}"
          echo "ROLLBACK_FILE_CHANGED=${env.ROLLBACK_FILE_CHANGED}"
          echo "PROMOTION_FILE_CHANGED=${env.PROMOTION_FILE_CHANGED}"
          echo "IS_ROLLBACK=${env.IS_ROLLBACK}"
          echo "IS_PROMOTION=${env.IS_PROMOTION}"
          echo "ROLLBACK_SERVICE=${env.ROLLBACK_SERVICE}"
          echo "ROLLBACK_NAMESPACE=${env.ROLLBACK_NAMESPACE}"
          echo "ROLLBACK_IMAGE_TAG=${env.ROLLBACK_IMAGE_TAG}"
          echo "PROMOTE_NAMESPACE=${env.PROMOTE_NAMESPACE}"
          echo "PROMOTE_SERVICES=${env.PROMOTE_SERVICES}"
          echo "PROMOTION_MODE=${env.PROMOTION_MODE}"
          echo "PROMOTION_PLAN=${env.PROMOTION_PLAN}"
          echo "RUN_USER=${env.RUN_USER}"
          echo "RUN_ORDER=${env.RUN_ORDER}"
          echo "RUN_PRODUCT=${env.RUN_PRODUCT}"
          echo "RUN_PAYMENT=${env.RUN_PAYMENT}"
          echo "RUN_SEARCH=${env.RUN_SEARCH}"
          echo "RUN_CONTROL_PLANE=${env.RUN_CONTROL_PLANE}"
        }
      }
    }

    stage('Update Prometheus') {
      when {
        changeset "prometheus-values.yaml"
      }
      agent {
        kubernetes {
          defaultContainer 'devops'
          yaml '''
    apiVersion: v1
    kind: Pod
    spec:
      serviceAccountName: jenkins-deployer
      containers:
        - name: devops
          image: 348071628290.dkr.ecr.ap-south-1.amazonaws.com/jenkins-agent-devops:latest
          command:
            - cat
          tty: true
    '''
        }
      }
      steps {
        container('devops') {
          checkout scm
          sh '''
            helm upgrade prometheus prometheus-community/prometheus \
              -n default \
              -f prometheus-values.yaml
          '''
        }
      }
    }

    stage('Promote') {
      when {
        expression { env.IS_PROMOTION == 'true' }
      }
      agent {
        kubernetes {
          defaultContainer 'devops'
          yaml '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins-deployer
  containers:
    - name: devops
      image: 348071628290.dkr.ecr.ap-south-1.amazonaws.com/jenkins-agent-devops:latest
      command:
        - cat
      tty: true
'''
        }
      }
      steps {
        container('devops') {
          checkout scm
          script {
            def common = load 'jenkins/common.groovy'
            def allowedPromotionServices = [
              'user-service',
              'order-service',
              'payment-service',
              'product-service',
              'search-service'
            ]
            def requestedServices = env.PROMOTE_SERVICES?.trim()
              ? env.PROMOTE_SERVICES.split(/\s*,\s*/).collect { it.trim() }.findAll { it }
              : allowedPromotionServices
            def explicitServiceSelection = env.PROMOTE_SERVICES?.trim() ? true : false
            def promotionItems = []

            requestedServices.each { serviceName ->
              def devImage = sh(
                script: """kubectl get deployment/${serviceName} -n dev -o jsonpath='{.spec.template.spec.containers[?(@.name=="${serviceName}")].image}' 2>/dev/null || true""",
                returnStdout: true
              ).trim()
              def prodImage = sh(
                script: """kubectl get deployment/${serviceName} -n prod -o jsonpath='{.spec.template.spec.containers[?(@.name=="${serviceName}")].image}' 2>/dev/null || true""",
                returnStdout: true
              ).trim()

              if (!devImage) {
                error "Cannot promote ${serviceName}: deployment image not found in dev."
              }

              if (devImage == prodImage && !explicitServiceSelection) {
                echo "Skipping ${serviceName}; prod already matches dev image ${devImage}."
              } else {
                def tagSeparator = devImage.lastIndexOf(':')
                if (tagSeparator < 0 || tagSeparator == devImage.length() - 1) {
                  error "Cannot parse image tag for ${serviceName} from dev image '${devImage}'."
                }

                def imageTag = devImage.substring(tagSeparator + 1)
                promotionItems << "${serviceName}:${imageTag}"
              }
            }

            if (!promotionItems) {
              error 'Promotion was confirmed, but no dev image differs from prod. Nothing to promote.'
            }

            env.PROMOTION_PLAN = promotionItems.join(',')
            echo "PROMOTION_PLAN=${env.PROMOTION_PLAN}"

            promotionItems.each { item ->
              def parts = item.split(':', 2)
              def serviceName = parts[0].trim()
              def imageTag = parts[1].trim()
              common.promoteService(this, serviceName, env.PROMOTE_NAMESPACE, imageTag)
            }
          }
        }
      }
    }

    stage('Rollback') {
      when {
        expression { env.IS_ROLLBACK == 'true' }
      }
      agent {
        kubernetes {
          defaultContainer 'devops'
          yaml '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins-deployer
  containers:
    - name: devops
      image: 348071628290.dkr.ecr.ap-south-1.amazonaws.com/jenkins-agent-devops:latest
      command:
        - cat
      tty: true
'''
        }
      }
      steps {
        script {
          def allowedRollbackServices = [
            'user-service',
            'order-service',
            'payment-service',
            'product-service',
            'search-service'
          ]
          def allowedRollbackNamespaces = ['dev', 'prod']

          if (!allowedRollbackServices.contains(env.ROLLBACK_SERVICE)) {
            error "Unsupported rollback service: ${env.ROLLBACK_SERVICE}"
          }

          if (!allowedRollbackNamespaces.contains(env.ROLLBACK_NAMESPACE)) {
            error "Unsupported rollback namespace: ${env.ROLLBACK_NAMESPACE}"
          }

          if (!(env.ROLLBACK_IMAGE_TAG ==~ /^[A-Za-z0-9_.-]+$/)) {
            error "Invalid rollback image tag: ${env.ROLLBACK_IMAGE_TAG}"
          }

          def image = "348071628290.dkr.ecr.ap-south-1.amazonaws.com/${env.ROLLBACK_SERVICE}:${env.ROLLBACK_IMAGE_TAG}"

          sh """
            kubectl set image deployment/${env.ROLLBACK_SERVICE} \
              ${env.ROLLBACK_SERVICE}=${image} \
              -n ${env.ROLLBACK_NAMESPACE}

            kubectl rollout status deployment/${env.ROLLBACK_SERVICE} -n ${env.ROLLBACK_NAMESPACE}
            kubectl get pods -n ${env.ROLLBACK_NAMESPACE}
          """
        }
      }
    }

    stage('Run Changed Services') {
      when {
        expression { env.IS_ROLLBACK != 'true' && env.IS_PROMOTION != 'true' }
      }
      agent {
        kubernetes {
          defaultContainer 'devops'
          yaml '''
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
      }
      steps {
        container('devops') {
          checkout scm
        }
        script {
          def common = load 'jenkins/common.groovy'

          if (env.RUN_USER == 'true') {
            common.runNamedServiceInCurrentNode(this, 'user-service')
          }

          if (env.RUN_ORDER == 'true') {
            common.runNamedServiceInCurrentNode(this, 'order-service')
          }

          if (env.RUN_PRODUCT == 'true') {
            common.runNamedServiceInCurrentNode(this, 'product-service')
          }

          if (env.RUN_PAYMENT == 'true') {
            common.runNamedServiceInCurrentNode(this, 'payment-service')
          }

          if (env.RUN_SEARCH == 'true') {
            common.runNamedServiceInCurrentNode(this, 'search-service')
          }

          if (env.RUN_CONTROL_PLANE == 'true') {
            common.runNamedServiceInCurrentNode(this, 'control-plane-service')
          }

          if (
            env.RUN_USER != 'true' &&
            env.RUN_ORDER != 'true' &&
            env.RUN_PRODUCT != 'true' &&
            env.RUN_PAYMENT != 'true' &&
            env.RUN_SEARCH != 'true' &&
            env.RUN_CONTROL_PLANE != 'true'
          ) {
            echo 'No service changes detected.'
          }
        }
      }
    }
  }

  post {
    always {
      echo 'Master pipeline completed.'
    }
  }
}
