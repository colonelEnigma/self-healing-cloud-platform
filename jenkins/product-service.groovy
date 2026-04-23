def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'

  def cfg = [
    serviceName   : 'product-service',
    awsRegion     : 'ap-south-1',
    ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
    ecrRepository : 'product-service',
    servicePath   : 'services/product-service',
    k8sPath       : 'k8s/product-service',
    deploymentFile: 'deployment.yml',
    serviceFile   : 'service.yml',
    kafkaAware    : true
  ]

  common.runService(scriptRef, cfg)
}

return this