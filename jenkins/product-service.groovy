def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'
  common.runNamedService(scriptRef, 'product-service')
}

return this
