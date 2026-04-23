FROM jenkins/inbound-agent:latest

USER root

# Install basic tools
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    git \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# Install kubectl
RUN curl -LO "https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/

# Install docker CLI (not daemon)
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-24.0.7.tgz \
    | tar xz \
    && mv docker/docker /usr/local/bin/ \
    && rm -rf docker

# Verify installs
RUN kubectl version --client && docker --version

# install aws cli v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && apt-get update && apt-get install -y unzip \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

# Verify installs
RUN aws --version

USER jenkins