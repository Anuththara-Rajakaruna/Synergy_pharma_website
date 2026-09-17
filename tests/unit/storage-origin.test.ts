import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getStorageUploadOrigin, readStorageEnv, storageBrowserOrigin, type StorageEnv } from "@/lib/storage-origin";
import { withCleanEnv } from "./support/env";

const credentials = { S3_ACCESS_KEY_ID: "AKIAEXAMPLEKEY", S3_SECRET_ACCESS_KEY: "example-secret-value" };

function settingsFor(env: Record<string, string>): StorageEnv {
  const result = readStorageEnv(env);
  assert.deepEqual(result.problems, [], JSON.stringify(result.problems));
  assert.ok(result.settings);
  return result.settings;
}

function problemVariables(env: Record<string, string>): string[] {
  return readStorageEnv(env).problems.map((problem) => problem.variable);
}

describe("readStorageEnv", () => {
  it("reads an AWS configuration with virtual-hosted addressing", () => {
    const settings = settingsFor({ ...credentials, S3_BUCKET: "synergy-cvs", S3_REGION: "ap-south-1" });
    assert.deepEqual(settings, {
      bucket: "synergy-cvs",
      region: "ap-south-1",
      endpoint: null,
      publicEndpoint: null,
      forcePathStyle: false,
      accessKeyId: credentials.S3_ACCESS_KEY_ID,
      secretAccessKey: credentials.S3_SECRET_ACCESS_KEY,
      serverSideEncryption: null,
    });
  });

  it("defaults the region to auto and path-style addressing when an endpoint is set", () => {
    const settings = settingsFor({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "https://account.r2.cloudflarestorage.com/" });
    assert.equal(settings.region, "auto");
    assert.equal(settings.forcePathStyle, true);
    assert.equal(settings.endpoint, "https://account.r2.cloudflarestorage.com");
  });

  it("honours S3_FORCE_PATH_STYLE and S3_SERVER_SIDE_ENCRYPTION", () => {
    const settings = settingsFor({
      ...credentials,
      S3_BUCKET: "cvs",
      S3_ENDPOINT: "https://s3.example.com",
      S3_FORCE_PATH_STYLE: "FALSE",
      S3_SERVER_SIDE_ENCRYPTION: "aws:kms",
    });
    assert.equal(settings.forcePathStyle, false);
    assert.equal(settings.serverSideEncryption, "aws:kms");
  });

  it("reports missing and invalid values by variable name", () => {
    assert.equal(readStorageEnv({}).anySet, false);
    assert.deepEqual(problemVariables({ S3_BUCKET: "cvs" }), ["S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
    assert.equal(readStorageEnv({ S3_BUCKET: "cvs" }).anySet, true);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_REGION: "auto" }), ["S3_REGION"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_REGION: "Asia Pacific" }), ["S3_REGION"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "bad/bucket", S3_REGION: "ap-south-1" }), ["S3_BUCKET"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "not a url" }), ["S3_ENDPOINT"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "ftp://files.example.com" }), ["S3_ENDPOINT"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "https://key:secret@files.example.com" }), ["S3_ENDPOINT"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "https://files.example.com?x=1" }), ["S3_ENDPOINT"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_REGION: "ap-south-1", S3_FORCE_PATH_STYLE: "yes" }), ["S3_FORCE_PATH_STYLE"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_REGION: "ap-south-1", S3_SERVER_SIDE_ENCRYPTION: "DES" }), ["S3_SERVER_SIDE_ENCRYPTION"]);
    assert.deepEqual(problemVariables({ ...credentials, S3_BUCKET: "cvs", S3_REGION: "ap-south-1", S3_PUBLIC_ENDPOINT: "files.example.com" }), ["S3_PUBLIC_ENDPOINT"]);
  });

  it("never includes secret values in problem messages", () => {
    const result = readStorageEnv({ S3_BUCKET: "cvs", S3_ENDPOINT: "https://leaky-key:leaky-secret@files.example.com", S3_ACCESS_KEY_ID: "leaky-key" });
    const text = JSON.stringify(result.problems);
    assert.equal(text.includes("leaky"), false, text);
  });
});

describe("storageBrowserOrigin", () => {
  it("uses the regional virtual-hosted AWS origin", () => {
    assert.equal(storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "synergy-cvs", S3_REGION: "ap-south-1" })), "https://synergy-cvs.s3.ap-south-1.amazonaws.com");
  });

  it("uses the regional path-style AWS origin for dotted and legacy bucket names", () => {
    assert.equal(storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "cvs.synergypharma.lk", S3_REGION: "ap-south-1" })), "https://s3.ap-south-1.amazonaws.com");
    assert.equal(storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "Legacy_Bucket", S3_REGION: "us-east-1" })), "https://s3.us-east-1.amazonaws.com");
    assert.equal(
      storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "synergy-cvs", S3_REGION: "ap-south-1", S3_FORCE_PATH_STYLE: "true" })),
      "https://s3.ap-south-1.amazonaws.com"
    );
  });

  it("uses amazonaws.com.cn for China regions", () => {
    assert.equal(storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "cvs-bucket", S3_REGION: "cn-north-1" })), "https://cvs-bucket.s3.cn-north-1.amazonaws.com.cn");
  });

  it("uses the endpoint origin for R2 and MinIO (path style), dropping any path", () => {
    assert.equal(
      storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "https://account.r2.cloudflarestorage.com" })),
      "https://account.r2.cloudflarestorage.com"
    );
    assert.equal(storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "http://127.0.0.1:9000/minio/" })), "http://127.0.0.1:9000");
  });

  it("prefixes the bucket for virtual-hosted custom endpoints, but never for IP addresses", () => {
    assert.equal(
      storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "https://account.r2.cloudflarestorage.com", S3_FORCE_PATH_STYLE: "false" })),
      "https://cvs.account.r2.cloudflarestorage.com"
    );
    assert.equal(
      storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "http://10.0.0.5:9000", S3_FORCE_PATH_STYLE: "false" })),
      "http://10.0.0.5:9000"
    );
    assert.equal(
      storageBrowserOrigin(settingsFor({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "http://[::1]:9000", S3_FORCE_PATH_STYLE: "false" })),
      "http://[::1]:9000"
    );
  });

  it("prefers the public endpoint browsers use over the internal endpoint", () => {
    assert.equal(
      storageBrowserOrigin(
        settingsFor({ ...credentials, S3_BUCKET: "cvs", S3_ENDPOINT: "http://minio.internal:9000", S3_PUBLIC_ENDPOINT: "https://files.synergypharma.lk" })
      ),
      "https://files.synergypharma.lk"
    );
  });
});

describe("getStorageUploadOrigin", () => {
  it("reads the process environment", () => {
    withCleanEnv({ ...credentials, S3_BUCKET: "synergy-cvs", S3_REGION: "ap-south-1" }, () => {
      assert.equal(getStorageUploadOrigin(), "https://synergy-cvs.s3.ap-south-1.amazonaws.com");
    });
  });

  it("returns null when storage is not configured or misconfigured", () => {
    withCleanEnv({}, () => assert.equal(getStorageUploadOrigin(), null));
    withCleanEnv({ S3_BUCKET: "cvs", S3_REGION: "auto" }, () => assert.equal(getStorageUploadOrigin(), null));
  });
});
