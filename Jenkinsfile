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

          def commonChanged = changedFiles.any { it == 'Jenkinsfile' || it == 'jenkins/common.groovy' }

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

          echo "Changed files: ${changedFiles}"
          echo "RUN_USER=${env.RUN_USER}"
          echo "RUN_ORDER=${env.RUN_ORDER}"
          echo "RUN_PRODUCT=${env.RUN_PRODUCT}"
          echo "RUN_PAYMENT=${env.RUN_PAYMENT}"
          echo "RUN_SEARCH=${env.RUN_SEARCH}"
        }
      }
    }

    stage('Run Changed Services') {
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