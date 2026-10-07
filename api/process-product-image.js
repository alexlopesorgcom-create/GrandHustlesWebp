const crypto = require("crypto");

const MAX_IMAGE_DATA_URL_LENGTH = 3_500_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const REPLICATE_API_URL =
  "https://api.replicate.com/v1/models/bria/remove-background/predictions";

function safeTokenEquals(providedToken, expectedToken) {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  return provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected);
}

async function readImageResponse(response) {
  if (!response.ok) {
    throw new Error("El servicio de recorte no pudo procesar la foto.");
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().split(";")[0].trim() !== "image/png") {
    throw new Error("El servicio no devolvió una imagen PNG transparente.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_OUTPUT_BYTES) {
    throw new Error("La imagen procesada tiene un tamaño no válido.");
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_OUTPUT_BYTES) {
      throw new Error("La imagen procesada tiene un tamaño no válido.");
    }
    chunks.push(chunk);
  }

  if (totalBytes === 0) {
    throw new Error("La imagen procesada tiene un tamaño no válido.");
  }

  const image = Buffer.concat(chunks, totalBytes);
  return `data:image/png;base64,${image.toString("base64")}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método no permitido."
    });
  }

  const configuredAccessToken = process.env.IMAGE_EDITOR_ACCESS_TOKEN;
  const replicateToken = process.env.REPLICATE_API_TOKEN;

  if (!configuredAccessToken ||
      configuredAccessToken.length < 32 ||
      !replicateToken) {
    return res.status(503).json({
      success: false,
      error: "El editor con IA aún no está configurado en Vercel."
    });
  }

  const authorization = req.headers.authorization || "";
  const providedAccessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!providedAccessToken ||
      !safeTokenEquals(providedAccessToken, configuredAccessToken)) {
    return res.status(401).json({
      success: false,
      error: "No tienes autorización para usar el editor de imágenes."
    });
  }

  const image = req.body && req.body.image;
  if (typeof image !== "string" ||
      image.length > MAX_IMAGE_DATA_URL_LENGTH ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    return res.status(400).json({
      success: false,
      error: "La foto no es válida o supera el tamaño permitido."
    });
  }

  try {
    const createResponse = await fetch(REPLICATE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        Prefer: "wait=20"
      },
      body: JSON.stringify({
        input: { image }
      })
    });

    if (!createResponse.ok) {
      console.error("Replicate image request failed:", createResponse.status);
      return res.status(502).json({
        success: false,
        error: "El servicio de IA no pudo procesar la foto. Intenta de nuevo."
      });
    }

    let prediction = await createResponse.json();
    const deadline = Date.now() + 40_000;

    while (prediction.status === "starting" ||
           prediction.status === "processing") {
      if (Date.now() >= deadline) {
        return res.status(504).json({
          success: false,
          error: "El procesamiento tardó demasiado. Intenta con otra foto."
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
      const predictionUrl = prediction.urls && prediction.urls.get;
      if (typeof predictionUrl !== "string") {
        throw new Error("El servicio de IA devolvió una respuesta incompleta.");
      }

      const parsedPredictionUrl = new URL(predictionUrl);
      if (parsedPredictionUrl.protocol !== "https:" ||
          !parsedPredictionUrl.hostname.endsWith(".replicate.com")) {
        throw new Error("El servicio de IA devolvió una dirección no válida.");
      }

      const predictionResponse = await fetch(parsedPredictionUrl, {
        headers: { Authorization: `Bearer ${replicateToken}` }
      });

      if (!predictionResponse.ok) {
        throw new Error("No se pudo consultar el procesamiento de la foto.");
      }
      prediction = await predictionResponse.json();
    }

    if (prediction.status !== "succeeded") {
      console.error("Replicate image prediction failed:", prediction.status);
      return res.status(502).json({
        success: false,
        error: "No se pudo detectar la prenda en esta foto. Prueba otra imagen."
      });
    }

    const outputUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;
    if (typeof outputUrl !== "string") {
      throw new Error("El servicio de IA no devolvió una imagen procesada.");
    }

    const parsedOutputUrl = new URL(outputUrl);
    if (parsedOutputUrl.protocol !== "https:" ||
        (parsedOutputUrl.hostname !== "replicate.delivery" &&
         !parsedOutputUrl.hostname.endsWith(".replicate.delivery"))) {
      throw new Error("El servicio de IA devolvió una dirección no válida.");
    }

    const outputResponse = await fetch(parsedOutputUrl);
    const processedImage = await readImageResponse(outputResponse);

    return res.status(200).json({
      success: true,
      image: processedImage
    });
  } catch (error) {
    console.error("Product image processing failed:", error.message);
    return res.status(502).json({
      success: false,
      error: "No se pudo procesar la foto con IA. Intenta de nuevo."
    });
  }
};

module.exports.config = {
  maxDuration: 60
};
