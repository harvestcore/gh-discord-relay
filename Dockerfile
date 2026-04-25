FROM denoland/deno:2.6.6

WORKDIR /app

COPY proxy.ts .

RUN deno cache proxy.ts

EXPOSE 8080

CMD ["run", "--allow-net", "--allow-env", "proxy.ts"]
