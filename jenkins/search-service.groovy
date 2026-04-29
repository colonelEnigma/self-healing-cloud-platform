def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'
  common.runNamedService(scriptRef, 'search-service')
}

return this
