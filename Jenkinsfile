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
        script {
          def changedFilesRaw = sh(
            script: 'git diff --name-only HEAD~1 HEAD || true',
            returnStdout: true
          ).trim()

          def changedFiles = changedFilesRaw ? changedFilesRaw.split('\n') : []

          env.ROLLBACK_FILE_CHANGED = changedFiles.contains('jenkins/rollback.env') ? 'true' : 'false'
          env.IS_ROLLBACK = 'false'

          if (env.ROLLBACK_FILE_CHANGED == 'true' && fileExists('jenkins/rollback.env')) {
            def rollbackText = readFile('jenkins/rollback.env').trim()

            def rollbackCfg = [:]
            rollbackText.split('\n').each { line ->
              line = line.trim()
              if (line && !line.startsWith('#') && line.contains('=')) {
                def parts = line.split('=', 2)
                rollbackCfg[parts[0].trim()] = parts[1].trim()
              }
            }

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

          def commonChanged = changedFiles.any { it == 'Jenkinsfile' || it == 'jenkins/common.groovy' }

          if (env.IS_ROLLBACK == 'true') {
            env.RUN_USER = 'false'
            env.RUN_ORDER = 'false'
            env.RUN_PRODUCT = 'false'
            env.RUN_PAYMENT = 'false'
            env.RUN_SEARCH = 'false'
          } else {
            env.RUN_USER = (
              commonChanged ||
              changedFiles.any {
                it.startsWith('services/user-service/') ||
                it.startsWith('k8s/user-service/') ||
                it == 'jenkins/user-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_ORDER = (
              commonChanged ||
              changedFiles.any {
                it.startsWith('services/order-service/') ||
                it.startsWith('k8s/order-service/') ||
                it == 'jenkins/order-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_PRODUCT = (
              commonChanged ||
              changedFiles.any {
                it.startsWith('services/product-service/') ||
                it.startsWith('k8s/product-service/') ||
                it == 'jenkins/product-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_PAYMENT = (
              commonChanged ||
              changedFiles.any {
                it.startsWith('services/payment-service/') ||
                it.startsWith('k8s/payment-service/') ||
                it == 'jenkins/payment-service.groovy'
              }
            ) ? 'true' : 'false'

            env.RUN_SEARCH = (
              commonChanged ||
              changedFiles.any {
                it.startsWith('services/search-service/') ||
                it.startsWith('k8s/search-service/') ||
                it == 'jenkins/search-service.groovy'
              }
            ) ? 'true' : 'false'
          }

          echo "Changed files: ${changedFiles}"
          echo "ROLLBACK_FILE_CHANGED=${env.ROLLBACK_FILE_CHANGED}"
          echo "IS_ROLLBACK=${env.IS_ROLLBACK}"
          echo "ROLLBACK_SERVICE=${env.ROLLBACK_SERVICE}"
          echo "ROLLBACK_NAMESPACE=${env.ROLLBACK_NAMESPACE}"
          echo "ROLLBACK_IMAGE_TAG=${env.ROLLBACK_IMAGE_TAG}"
          echo "RUN_USER=${env.RUN_USER}"
          echo "RUN_ORDER=${env.RUN_ORDER}"
          echo "RUN_PRODUCT=${env.RUN_PRODUCT}"
          echo "RUN_PAYMENT=${env.RUN_PAYMENT}"
          echo "RUN_SEARCH=${env.RUN_SEARCH}"
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
        expression { env.IS_ROLLBACK != 'true' }
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
          if (env.RUN_USER == 'true') {
            def svc = load 'jenkins/user-service.groovy'
            svc.run(this)
          }

          if (env.RUN_ORDER == 'true') {
            def svc = load 'jenkins/order-service.groovy'
            svc.run(this)
          }

          if (env.RUN_PRODUCT == 'true') {
            def svc = load 'jenkins/product-service.groovy'
            svc.run(this)
          }

          if (env.RUN_PAYMENT == 'true') {
            def svc = load 'jenkins/payment-service.groovy'
            svc.run(this)
          }

          if (env.RUN_SEARCH == 'true') {
            def svc = load 'jenkins/search-service.groovy'
            svc.run(this)
          }

          if (
            env.RUN_USER != 'true' &&
            env.RUN_ORDER != 'true' &&
            env.RUN_PRODUCT != 'true' &&
            env.RUN_PAYMENT != 'true' &&
            env.RUN_SEARCH != 'true'
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