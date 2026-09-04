export async function requestMicrophone(): Promise<never> {
  throw new Error('Realtime voice requires an approved native WebRTC development-build adapter.');
}

export async function connectOpenAIRealtime(): Promise<never> {
  throw new Error('Realtime voice requires an approved native WebRTC development-build adapter.');
}

export async function prepareOpenAIRealtime(): Promise<never> {
  throw new Error('Realtime voice requires an approved native WebRTC development-build adapter.');
}
