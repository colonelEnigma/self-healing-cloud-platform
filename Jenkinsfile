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
            env.CONFIRM_PROMOTION_VALUE  = promotionCfg['CONFIRM_PROMOTION'] ?: ''

            if (
              env.PROMOTION_ACTION_VALUE == 'promote' &&
              env.CONFIRM_PROMOTION_VALUE == 'true' &&
              env.PROMOTE_NAMESPACE?.trim()
            ) {
              if (env.PROMOTE_NAMESPACE != 'prod') {
                error "Promotion target must be prod; got '${env.PROMOTE_NAMESPACE}'."
              }

              def changedPromotionServices = []

              def serviceChangeRules = [
                'user-service': { files ->
                  files.any {
                    it.startsWith('services/user-service/') ||
                    it.startsWith('k8s/user-service/') ||
                    it == 'jenkins/user-service.groovy'
                  }
                },
                'order-service': { files ->
                  files.any {
                    it.startsWith('services/order-service/') ||
                    it.startsWith('k8s/order-service/') ||
                    it == 'jenkins/order-service.groovy'
                  }
                },
                'payment-service': { files ->
                  files.any {
                    it.startsWith('services/payment-service/') ||
                    it.startsWith('k8s/payment-service/') ||
                    it == 'jenkins/payment-service.groovy'
                  }
                },
                'product-service': { files ->
                  files.any {
                    it.startsWith('services/product-service/') ||
                    it.startsWith('k8s/product-service/') ||
                    it == 'jenkins/product-service.groovy'
                  }
                },
                'search-service': { files ->
                  files.any {
                    it.startsWith('services/search-service/') ||
                    it.startsWith('k8s/search-service/') ||
                    it == 'jenkins/search-service.groovy'
                  }
                }
              ]

              allowedPromotionServices.each { service ->
                if (serviceChangeRules[service](changedFiles)) {
                  changedPromotionServices << service
                }
              }

              if (changedPromotionServices && !changedPromotionServices.isEmpty()) {
                env.PROMOTION_PLAN = changedPromotionServices.collect { service -> "${service}:${env.CURRENT_SHORT_COMMIT}" }.join(',')
                env.PROMOTE_SERVICES = changedPromotionServices.join(',')
                env.PROMOTION_MODE = 'changed-services-current-sha'
                env.IS_PROMOTION = 'true'
              } else {
                error 'Promotion was confirmed, but no supported app service changes were detected in this commit.'
              }
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
          script {
            def common = load 'jenkins/common.groovy'
            if (!env.PROMOTION_PLAN?.trim()) {
              error 'PROMOTION_PLAN is empty. Confirm promotion with service changes in the same commit.'
            }

            def promotionItems = env.PROMOTION_PLAN.split(',').collect { it.trim() }.findAll { it }
            promotionItems.each { item ->
              def parts = item.split(':', 2)
              def serviceName = parts[0].trim()
              def imageTag = parts[1].trim()
              common.runNamedServiceToTargetsInCurrentNode(this, serviceName, ['dev', 'test'])
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
          def allowedRollbackNamespaces = ['dev', 'test', 'prod']

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
