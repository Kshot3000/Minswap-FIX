### How to Build and Use

1. Update the code.
2. Add, update, or fix tests.
3. Run `cargo build && cargo test`.
4. Build the Docker image:
  ```sh
  docker build -t minswap-csl .
  ```
5. Run Docker Compose:
  ```sh
  docker compose up -d --build
  ```
6. Execute into the Docker container to build the Node.js SDK:
  ```bash
  # Execute into the Docker container
  docker exec -it ${CONTAINER_ID} /bin/bash
  # Build Rust
  cargo build
  # Change directory back to root
  cd ..
  # Install npm dependencies
  npm install
  # Build Node.js SDK
  npm run rust:build-nodejs
  # Exit Docker
  ```
7. The final build is stored on your local machine at `./rust/pkg` due to mounting `.:/usr/src/app`.

Contact
-------
X handle: https://x.com/kshot9000

Donation Address
----------------
addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v
<EOF>