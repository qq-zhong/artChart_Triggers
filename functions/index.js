const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

const config = require('./config.json');

const OPENAI_API_KEY = config.OPENAI_API_KEY;


admin.initializeApp();

const db = admin.database();
const storage = admin.storage();

exports.processArtwork = functions.database
  .ref("/artwork/{artworkId}")
  .onCreate(async (snapshot, context) => {
    const artworkData = snapshot.val(); // Get the newly added artwork data
    const artworkId = context.params.artworkId;

    if (!artworkData.imageUrl) {
      console.error("No imageUrl found in the newly added artwork entry.");
      return null;
    }

    try {
      const imageUrl = artworkData.imageUrl;
      console.log(`Processing artwork ID: ${artworkId}, Image URL: ${imageUrl}`);

      // Convert image URL to Base64
      const base64Image = await fetchImageAsBase64(imageUrl);

      // Call OpenAI API with the Base64 image
      const isArtResponse = await evaluateImageWithOpenAi(base64Image);

      console.log(`OpenAI classification for artwork ID ${artworkId}: ${isArtResponse}`);

      // Update `isArt` to false if the response is "NO"
      if (isArtResponse === "YES") {
        await db.ref(`/artwork/${artworkId}`).update({
          detectArt: true,
        });
        // console.log(`Updated detectArt field to true for artwork ID: ${artworkId}`);
        console.log(` artwork ID: ${artworkId} has been approved`);
      }

      return null;
    } catch (error) {
      console.error("Error processing artwork:", error.message);
      return null;
    }
  });

// Function to fetch an image from a URL and convert it to Base64
async function fetchImageAsBase64(imageUrl) {
  try {
    const bucket = storage.bucket(); // Access Firebase Storage bucket

    // Extract the path from the imageUrl
    const path = decodeURIComponent(imageUrl.split("/o/")[1].split("?")[0]);

    console.log(`Fetching file from storage path: ${path}`);

    // Download the file as a buffer
    const [fileBuffer] = await bucket.file(path).download();

    // Convert the buffer to Base64
    return fileBuffer.toString("base64");
  } catch (error) {
    console.error("Error fetching and converting image to Base64:", error.message);
    throw error;
  }
}

// Function to call OpenAI API with a Base64-encoded image
async function evaluateImageWithOpenAi(base64Image) {


  const payload = {
    model: "gpt-4o-mini", // Ensure this model supports image input
    messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Is this image art or not? Only use the word 'YES' or 'No'" },
            { type: "image_url", image_url: { "url": `data:image/png;base64,${base64Image}` } },
          ],
        },
      ],
      max_tokens: 150,
    // messages: [
    //   {
    //     role: "user",
    //     content: "Is this image art or not? Only respond with 'YES' or 'NO'.",
    //   },
    //   {
    //     role: "user",
    //     content: {
    //       type: "image",
    //       image: `data:image/png;base64,${base64Image}`, // Send the Base64 image
    //     },
    //   },
    // ],
    // max_tokens: 10,
  };

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const openAiResponse = response.data.choices[0].message.content.trim();
    console.log(`OpenAI response: ${openAiResponse}`);

    // Return "YES" or "NO"
    return openAiResponse;
  } catch (error) {
    // Check if the error has a response (i.e., the request was made but failed)
    if (error.response) {
      console.error("Error calling OpenAI API:");
      console.error("Status Code:", error.response.status);
      console.error("Response Body:", JSON.stringify(error.response.data, null, 2));
    } else {
      // If there's no response, log the error message itself (e.g., network issue)
      console.error("Error calling OpenAI API - No response received:", error.message);
    }
    throw error; // Rethrow the error so it can be handled by the caller if necessary
  }
}
