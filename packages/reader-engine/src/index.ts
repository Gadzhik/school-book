/**
 * Публичный API пакета @reader/reader-engine.
 */
export * from './types';
export * from './reader';
export { ensureFoliate } from './foliate-loader';
export { FOLIATE_PUBLIC_BASE } from './constants';
export {
  isTtsSupported,
  getVoices,
  type TtsOptions,
  type TtsCallbacks,
} from './tts-web';
