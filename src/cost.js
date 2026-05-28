const imageUsd = {
  "1024x1024": { low: 0.005, medium: 0.011, high: 0.036 },
  "1024x1536": { low: 0.006, medium: 0.015, high: 0.05 },
  "1536x1024": { low: 0.006, medium: 0.015, high: 0.05 }
};

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

export function estimateImageUsd(size, quality) {
  return imageUsd[size]?.[quality] ?? imageUsd["1024x1536"].low;
}

export function estimateStoryCost({ promptText, outputText, sceneCount, imageSize, imageQuality, narrationChars, pricing }) {
  const inputTokens = estimateTokens(promptText);
  const outputTokens = estimateTokens(outputText);
  const storyInputUsd = (inputTokens / 1_000_000) * pricing.storyInputUsdPer1MTokens;
  const storyOutputUsd = (outputTokens / 1_000_000) * pricing.storyOutputUsdPer1MTokens;
  const imageUnitUsd = estimateImageUsd(imageSize, imageQuality);
  const imageUsdTotal = sceneCount * imageUnitUsd;
  const ttsUsd = (Math.max(0, narrationChars) / 1_000_000) * pricing.ttsUsdPer1MChars;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    storyUsd: roundUsd(storyInputUsd + storyOutputUsd),
    imageUnitUsd: roundUsd(imageUnitUsd),
    imageUsd: roundUsd(imageUsdTotal),
    ttsUsd: roundUsd(ttsUsd),
    totalUsd: roundUsd(storyInputUsd + storyOutputUsd + imageUsdTotal + ttsUsd)
  };
}

export function estimateTtsUsd(chars, provider, pricing) {
  const count = Math.max(0, Number(chars || 0));
  if (String(provider || "").toLowerCase() === "elevenlabs") {
    return roundUsd((count / 1000) * Number(pricing.elevenlabsTtsUsdPer1KChars || 0));
  }
  return roundUsd((count / 1_000_000) * Number(pricing.ttsUsdPer1MChars || pricing.openaiTtsUsdPer1MChars || 0));
}

function roundUsd(value) {
  return Number(value.toFixed(5));
}
