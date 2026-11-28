# Pocketface avatars

Pocketface is off by default. The host can enable it under **Table → Pocketface avatars**. Each seated player gets their own editor. Hosts choose an avatar before adding each bot and can edit existing bots under **Players**.

Players can choose an illustrated face or use a front-facing portrait. Face matching runs on the controller. It sends a compressed crop and fitted coordinates to the room when the player saves. The TV receives portraits for its cast and the host can edit bot portraits. Saved sessions keep their profiles. Avatars stand at their own chip trays in the 3D table scene. The automatic camera follows their throws and reactions.

## Build and asset sources

The usual `npm ci` and `npm run build` commands bundle the avatar rig and fit model. The Vite config copies the WASM files from the locked MediaPipe package. The display and controllers can use Pocketface on the same local network without internet access.

- The Pocketface browser runtime and rig are from revision `669a5c2f8ed33589b4bfe894d67395b307a5fd76`.
- Google's [MediaPipe Tasks Vision SDK](https://github.com/google-ai-edge/mediapipe) and [Face Landmarker model](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) use the [Apache 2.0 license](../public/pocketface/LICENSE-MediaPipe.txt). The model's SHA-256 is `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
