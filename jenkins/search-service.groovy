def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'

  def cfg = [
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

  common.runService(scriptRef, cfg)
}

return this