export interface Env {
    USERS_KV: KVNamespace;
    SESSIONS_KV: KVNamespace;
    DOCS_KV: KVNamespace;
    SHARES_KV: KVNamespace;
    DOCS_BUCKET: R2Bucket;
    ASSETS: Fetcher;
    SESSION_TTL_SECONDS: string;
    PASSWORD_PEPPER?: string;
}

export interface UserRecord {
    username: string;
    salt: string;
    hash: string;
    createdAt: string;
}

export interface DocMeta {
    id: string;
    owner: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    shareToken?: string;
}
