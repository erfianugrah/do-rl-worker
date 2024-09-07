import { hashValue } from './utils.js';

const TOKEN_EXPIRY = 24 * 60 * 60; // 24 hours in seconds

export async function generateToken(state, fingerprint) {
  const timestamp = Math.floor(Date.now() / 1000);
  const expiryTime = timestamp + TOKEN_EXPIRY;
  const tokenData = `${fingerprint}|${expiryTime}`;
  const hashedToken = await hashValue(tokenData);
  const token = `${hashedToken}.${expiryTime}`;

  // Store the token in Durable Object storage
  await state.storage.put(`token:${hashedToken}`, {
    fingerprint,
    expiryTime,
  });

  return token;
}

export async function verifyToken(state, token) {
  const [hashedToken, expiryTime] = token.split('.');
  const now = Math.floor(Date.now() / 1000);

  if (now > parseInt(expiryTime, 10)) {
    return false; // Token has expired
  }

  // Retrieve token data from Durable Object storage
  const tokenData = await state.storage.get(`token:${hashedToken}`);

  if (!tokenData) {
    return false; // Token not found in storage
  }

  if (tokenData.expiryTime !== parseInt(expiryTime, 10)) {
    return false; // Expiry time mismatch
  }

  return tokenData.fingerprint; // Return the fingerprint if token is valid
}

export async function cleanupExpiredTokens(state) {
  const now = Math.floor(Date.now() / 1000);
  const allTokens = await state.storage.list({ prefix: 'token:' });

  for (const [key, value] of allTokens) {
    if (value.expiryTime < now) {
      await state.storage.delete(key);
    }
  }
}
