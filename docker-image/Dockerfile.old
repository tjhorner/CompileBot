############################################################
# Dockerfile to build sandbox for executing user code
# Based on Ubuntu
############################################################

# FROM chug/ubuntu14.04x64
FROM ubuntu:16.04

# Update the repository sources list
RUN echo "deb http://archive.ubuntu.com/ubuntu trusty main universe" > /etc/apt/sources.list
RUN apt-get update
#RUN apt-get upgrade
#Install all the languages/compilers we are supporting.
RUN apt-get install -y gcc
RUN apt-get install -y g++
RUN apt-get install -y php5-cli
RUN apt-get install -y ruby
RUN apt-get install -y python
RUN apt-get install -y mono-xsp2 mono-xsp2-base

RUN apt-get install -y mono-vbnc
RUN apt-get install -y npm
# RUN apt-get install -y golang-go
RUN apt-get install -y nodejs

RUN npm config set strict-ssl false
RUN npm install -g underscore request express jade shelljs passport http sys jquery lodash async mocha moment connect validator restify ejs ws co when helmet wrench brain mustache should backbone forever  debug && export NODE_PATH=/usr/local/lib/node_modules/

RUN apt-get install -y clojure1.4

#prepare for Java download
RUN apt-get install -y python-software-properties
RUN apt-get install -y software-properties-common

#grab oracle java (auto accept licence)
RUN add-apt-repository -y ppa:webupd8team/java
RUN apt-get update
RUN echo oracle-java8-installer shared/accepted-oracle-license-v1-1 select true | /usr/bin/debconf-set-selections
RUN apt-get install -y oracle-java8-installer


RUN apt-get install -y gobjc
RUN apt-get install -y gnustep-devel &&  sed -i 's/#define BASE_NATIVE_OBJC_EXCEPTIONS     1/#define BASE_NATIVE_OBJC_EXCEPTIONS     0/g' /usr/include/GNUstep/GNUstepBase/GSConfig.h


RUN apt-get install -y scala
RUN apt-get install -y mysql-server
RUN apt-get install -y perl

RUN apt-get install -y curl
RUN mkdir -p /opt/rust && \
    curl https://sh.rustup.rs -sSf | HOME=/opt/rust sh -s -- --no-modify-path -y && \
    chmod -R 777 /opt/rust

RUN apt-get install -y sudo
RUN apt-get install -y bc

RUN apt-get install -y lua5.1 lua5.2 lua50

RUN mkdir /output
RUN chown mysql /output
RUN chmod 755 /output
RUN chmod g+w /output

RUN echo "mysql ALL = NOPASSWD: /usr/sbin/service mysql start" | cat >> /etc/sudoers

# Lua 5.3 isn't available from the official repos
COPY ./lua53 /usr/bin/lua53
COPY ./luac53 /usr/bin/luac53
RUN chmod +x /usr/bin/lua*

# PHP 7
RUN LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php
RUN LC_ALL=C.UTF-8 add-apt-repository -y ppa:gophers/archive
RUN apt-get update
RUN apt-get install -y php7.0-cli

# Java runner
COPY ./runjava.sh /usr/bin/runjava
RUN chmod +x /usr/bin/runjava

RUN apt-get install -y python-pip python3-pip libyaml-dev
RUN pip3 install pyyaml
# RUN pip install pyyaml

RUN apt-get install -y golang-1.10-go
RUN ln -s /usr/lib/go-1.10/bin/go /usr/bin/go
RUN chmod +x /usr/lib/go-1.10/bin/go