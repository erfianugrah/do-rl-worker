// utils.js
export async function hashValue(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return hashHex;
}

export async function generateEncryptionKey() {
  return await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    [
      "encrypt",
      "decrypt",
    ],
  );
}

export async function encryptData(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(data);

  const encryptedData = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encodedData,
  );

  return { encryptedData, iv };
}

export async function decryptData(key, encryptedData, iv) {
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encryptedData,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}

export async function exportKey(key) {
  const exported = await crypto.subtle.exportKey("raw", key);
  return Array.from(new Uint8Array(exported));
}

export async function importKey(keyData) {
  return await crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyData),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}
