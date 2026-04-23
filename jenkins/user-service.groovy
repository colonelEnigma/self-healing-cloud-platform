def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'

  def cfg = [
    serviceName   : 'user-service',
    awsRegion     : 'ap-south-1',
    ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
    ecrRepository : 'user-service',
    servicePath   : 'services/user-service',
    k8sPath       : 'k8s/user-service',
    deploymentFile: 'deployment.yml',
    serviceFile   : 'service.yml',
    kafkaAware    : false
  ]

  common.runService(scriptRef, cfg)
}

return this