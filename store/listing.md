# Microsoft Store listing (copy and paste into Partner Center)

Fill each Partner Center page from the matching section below. Everything here is plain text you
can paste as is. The package to upload is `Lotus-windows-x64.msix` from the newest GitHub release.

## 1. Reserve the name

Try these in order and keep the first one Partner Center accepts:

1. **Lotus AI Studio** (recommended, and already set in `src-tauri/msix/Package.appxmanifest`)
2. Lotus: Your Own AI
3. Lotus Local AI
4. Lotus Studio for AI

If you reserve anything other than the first, tell Claude: the name in the package must match.

## 2. Product identity (send these back)

On **Product management → Product identity**, copy these three lines and send them to Claude:

- Package/Identity/Name
- Package/Identity/Publisher
- Package/Properties/PublisherDisplayName

## 3. Pricing and availability

- Markets: all markets
- Pricing: **Free**
- Free trial: none
- Visibility: public, discoverable in the Store

When Lotus Pro launches (not now): tick the option that the product uses a third-party payment
system for in-app purchases. Non-game apps may sell through their own payment provider (Polar) and
keep 100%.

## 4. Properties

- Category: **Productivity** (subcategory: none)
- Privacy policy URL: https://github.com/filipesilva0/Lotus/blob/main/PRIVACY.md
- Website: https://github.com/filipesilva0/Lotus
- Support contact: https://github.com/filipesilva0/Lotus/issues
- Product declarations: tick "This app has been tested to meet accessibility guidelines" only if
  you have checked it; leave the others as they are.
- System requirements: Windows 10 version 1809 or newer, 64-bit. Recommended: 16 GB memory and a
  graphics card with 8 GB of video memory for the larger models.

## 5. Age ratings (questionnaire)

- Category: **All other app types**
- Does the app let users interact or exchange content with other users? **No**
- Does the app share the user's location with other users? **No**
- Does the app allow purchases of digital goods? **No** (change to Yes when Pro launches)
- Does the app provide unrestricted internet access (a browser or search)? **Yes**: web search and
  the optional browser tool.
- Does the app generate content with AI? **Yes**: text, images and speech, made on the user's own PC.
- Violence, fear, sexuality, gambling, language, drugs: **No** to each (the app itself contains none).

## 6. Store listing (English)

**Product name:** Lotus AI Studio

**Short description (up to 100 characters for some views):**

Your own AI. One app instead of four.

**Description:**

Lotus is your own AI, running on your own PC. Chat, talk, make images and get things done, all in
one calm window, with no account and nothing sent to a server.

Lotus picks the models that fit your computer and downloads them for you. No terminal, no engine
names, no model tags.

What you can do:
• Chat with an assistant that can use tools, search the web when you ask, and remember what matters.
• Hold a voice call you can interrupt mid-sentence, in a voice you choose, fully offline.
• Make images from a sentence.
• Hand a bigger job to Work, where several agents split it up and finish it together.
• Dictate anywhere and have text read aloud.
• Keep tasks and routines in one place.

Private by design: your chats, images and voices stay in the Lotus Studio folder on your PC. There
is no telemetry. Lotus only goes online for what you switch on, such as web search or a model
download.

For enthusiasts: Advanced mode lets you pick engines and model files, connect MCP servers, use your
own cloud API key and run a local API. Lotus can also drive Ollama, ComfyUI and Voicebox if you
already use them.

Lotus is an early preview. Expect rough edges, and tell us what you find on GitHub.

**What's new in this version:** First release in the Microsoft Store.

**Product features (one per line, up to 20):**

Chat with a local AI assistant
Voice calls you can interrupt
Image generation on your own PC
Work: agents that finish bigger jobs together
Dictation and read-aloud
Works offline, no account
Advanced mode for local-AI enthusiasts

**Search terms (up to 7):** local AI, offline AI, AI chat, AI assistant, image generator, voice
assistant, LLM

**Screenshots (Desktop, at least 1366 × 768):**

1. `docs/assets/showcase-light.png`: Work page, three agents built a plan together
2. `docs/assets/showcase-dark.png`: the same in dark mode

More screenshots (chat, voice call, images) can be added later from the app.

**App tile icon / logos:** taken from the package; nothing to upload.

## 7. Submission options and notes for certification

**Restricted capability runFullTrust, why it is needed:**

Lotus is a desktop app built with Tauri. It runs a local background process (lotusd) and local AI
engines on the user's own PC, which requires full trust.

**Notes for certification:**

Lotus is a local AI app. On first start a setup guide offers to download open-source AI engines
(llama.cpp, stable-diffusion.cpp, sherpa-onnx) from their official GitHub release pages and AI
models from Hugging Face. These are chosen by the user, downloaded only on request, and run on the
user's own computer; they are the core described function of the app and do not change it. No
account or sign-in is needed to test: open the app, follow the setup guide, then chat.
