// SPDX-License-Identifier: AGPL-3.0-only

// Ordinary source code that names keys, tokens, passwords and secrets without
// holding any. Written for these tests in the shapes a sample of 6,000 files
// from installed npm packages and the Python standard library showed the
// detector used to take for secret values: identifiers, member access, type
// annotations, generics, constants, header names, error codes, package
// versions, template placeholders and bundler-renamed variables. None of it
// may be masked, rewritten or denied.

export const NORMAL_CODE = {
  'src/env.ts': `import Stripe from 'stripe';

const JWT_SECRET = process.env.JWT_SECRET!;
const SESSION_SECRET = process.env.SESSION_SECRET as string;
const stripe = new Stripe(process.env.STRIPE_KEY as string);

export const cfg = { apiKey: API_KEY, secret: SECRET_KEY, token: authToken };
export default { apiKey: API_KEY, jwtSecret: JWT_SECRET, stripe };
`,
  'src/credentials.d.ts': `import type { AccessToken, GetTokenOptions, TokenCredential } from './auth';

export interface ClientSecretCredentialOptions {
  tokenCredentialOptions: TokenCredentialOptions;
  clientSecret: string;
  privateKey: CryptoKey;
  passphrase?: string;
}

export declare class ClientSecretCredential implements TokenCredential {
  private clientSecret;
  getToken: CredentialLoggerInstance;
  getAccessToken: (scopes: string | string[], options: GetTokenOptions) => Promise<AccessToken | null>;
  setRefreshTokenCredential(refreshToken: RefreshTokenEntity, correlationId: string): Promise<void>;
  rangeTokenPairs: PartitionRangeWithContinuationToken[];
  idTokenClaims: TokenClaims;
}

export type AccessTokenGetter = (scopes: string | string[], options: GetTokenOptions) => Promise<AccessToken>;
export type ResetPasswordStartParams = ResetPasswordParamsBase;
export type SignInSubmitPasswordResultState = SignInCompletedState | SignInFailedState;
export declare const parseCalcTokens: (tokens: CSSToken[], opt?: Options) => string[];
`,
  'src/constants.ts': `export const HttpHeaders = {
  SessionToken: "x-ms-session-token",
  ContinuationToken: "x-ms-continuation-token",
  ResourceTokenExpiry: "x-ms-documentdb-expiry-seconds",
} as const;

export const ACQUIRE_TOKEN_SUCCESS = "msal:acquireTokenSuccess";
export const GET_ACCESS_TOKEN_FAILED_STATE_TYPE = "GetAccessTokenFailedState";
export const PASSWORD_TOO_WEAK = "password_too_weak";
export const PASSWORD_TOO_SHORT = "password_too_short";
export const unableToParseTokenRequestCacheError = "unable_to_parse_token_request_cache_error";
export const bearerTokenAuthenticationPolicyName = "bearerTokenAuthenticationPolicy";
export type DefaultAzureCredentialEnvVars = "AZURE_TOKEN_CREDENTIALS" | "AZURE_CLIENT_ID" | "AZURE_CLIENT_SECRET";
`,
  'src/client.js': `export class Client {
  constructor(options, credential, partitionKey) {
    this.partitionKey = partitionKey;
    this.xmlCharKey = options.xmlCharKey;
    this.tokenCredentialOptions = options ?? {};
    this.continuationToken = responseHeaders[Constants.HttpHeaders.Continuation];
    this.sessionToken = responseMessage.headers?.[Constants.HttpHeaders.SessionToken];
    this.tokenRangeMappings = [queryRange];
    this.credentialUnavailableErrorMessage = message;
    this.clientSecret = clientSecretOrAuthorizationCode;
  }

  async page() {
    const { continuationToken: continuationToken2 } = this.manager.paginateResults();
    const auxiliaryTokens = (await Promise.all(tokenPromises)).filter((token) => Boolean(token));
    const accessTokenKeys: Array<string> = [];
    var parseCalcTokens = (tokens, opt = {}) => tokens.map(String);
    this.logger.trace("CacheManager.getAccessTokenCredential: called, no cache hit");
    logger.info(\`clientId: \${clientId} and clientSecret: [REDACTED]\`);
    return { rangeTokenPairs: rangeTokenPairs2, continuationToken2 };
  }
}
`,
  'package.json': `{
  "name": "shop-api",
  "version": "2.3.0",
  "repository": { "type": "git", "url": "git+ssh://git@github.com/acme/shop-api.git" },
  "dependencies": {
    "jsonwebtoken": "^9.0.2",
    "js-tokens": "^4.0.0",
    "@azure/keyvault-secrets": "^4.8.0",
    "passport-oauth2-client-password": "~0.1.2",
    "secret-handshake": ">=1.1.20"
  }
}
`,
  'app/settings.py': `import os

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
API_KEY = settings.API_KEY
password = kwargs.get("password")
token = request.headers.get("Authorization", "").removeprefix("Bearer ")
db_password = config.database.password
AUTH_PASSWORD_VALIDATORS = [{"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"}]
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD")
secret = "%(password)s"


def login(username, password=None, token=None):
    """Log in. The password and token come from the caller."""
    return backend.authenticate(username=username, password=password)
`,
  'templates/config.j2': `db:
  password: {{ db_password }}
  token: \${API_TOKEN}
  secret: <%= secret %>
  api_key: $API_KEY
`,
  'deploy/secret.yaml': `apiVersion: v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: api
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: password
      imagePullSecrets:
        - name: registry-token
`,
  'infra/main.tf': `variable "db_password" {
  type      = string
  sensitive = true
}

resource "aws_db_instance" "main" {
  password = var.db_password
  username = "app"
}
`,
  'styles/tokens.css': `.token-primary { color: var(--token-primary); }
.password-strength-meter { width: 100%; }
:root { --secret-panel-bg: #1e1e2e; --api-key-row: 48px; }
`,
  'main.go': `package main

func connect(cfg Config) error {
\tpassword := cfg.Database.Password
\ttoken := os.Getenv("GITHUB_TOKEN")
\tapiKey := viper.GetString("api_key")
\treturn db.Open(cfg.Database.User, password, token, apiKey)
}
`,
  'CHANGELOG.md': `## 2.3.0

- Rotate the \`JWT_SECRET\` without downtime (see \`process.env.JWT_SECRET_ROTATION_DAYS\`).
- \`STRIPE_API_KEY\` and \`OPENAI_API_KEY\` are read from the environment.
- Resized thumbnails to 1920 1080 and 1280 720; buffers are 2048 4096 8192.
- Clone with \`git clone git@github.com:acme/shop-api.git\`.
`,
};
