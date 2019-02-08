FROM alpine:3.9

RUN apk add --no-cache \
    bash \
    g++ \
    openjdk8 \
    nodejs \
    python2 \
    python3 \
    ruby \
    php7 \
    go \
    lua5.1 \
    lua5.2 \
    lua5.3

# Properly link javac
RUN ln -s /usr/lib/jvm/java-1.8-openjdk/bin/javac /usr/bin/javac

# Java runner
COPY ./runjava.sh /usr/bin/runjava
RUN chmod +x /usr/bin/runjava

# Setup sandbox stuff
RUN mkdir -p /output
RUN adduser -D -H -u 1000 compilebot
RUN chown compilebot /output
RUN chmod 755 /output
RUN chmod g+w /output