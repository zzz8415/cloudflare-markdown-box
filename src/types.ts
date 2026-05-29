export interface Env {
    USERS_KV: KVNamespace;
    SESSIONS_KV: KVNamespace;
    DOCS_KV: KVNamespace;
    SHARES_KV: KVNamespace;
    DOCS_BUCKET: R2Bucket;
    ASSETS: Fetcher;
    SESSION_TTL_SECONDS: string;
    PASSWORD_PEPPER?: string;
    ADMIN_BOOTSTRAP_PASSWORD?: string;
    PASSWORD_HASH_ITERATIONS?: string;
}

export interface UserRecord {
    username: string;
    salt: string;
    hash: string;
    createdAt: string;
    hashAlgorithm?: "sha256" | "pbkdf2";
    hashIterations?: number;
}

export interface DocMeta {
    id: string;
    owner: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    shareToken?: string;
}
