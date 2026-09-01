import { Injectable } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";
import { createReadStream, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { notFound } from "../../common/errors";

const ASSET_TYPES: Record<string, string> = {
    "swagger-ui.css": "text/css; charset=utf-8",
    "swagger-ui-bundle.js": "application/javascript; charset=utf-8",
};

/**
 * Holds the generated OpenAPI document and the swagger-ui assets. The public /api/docs mount is
 * intentionally absent; only admin routes serve this material.
 */
@Injectable()
export class OpenApiService {
    private document: OpenAPIObject | null = null;
    private readonly assetRoot = dirname(require.resolve("swagger-ui-dist/package.json"));

    setDocument(document: OpenAPIObject) {
        this.document = document;
    }

    getDocument(): OpenAPIObject {
        if (!this.document) throw notFound("接口文档尚未就绪");
        return this.document;
    }

    docsHtml() {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>接口文档</title>
  <link rel="stylesheet" href="/api/admin/docs/swagger-ui.css" />
  <style>body{margin:0;background:#fff}.topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/admin/docs/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/admin/openapi.json",
      dom_id: "#swagger-ui",
      persistAuthorization: true,
      withCredentials: true
    });
  </script>
</body>
</html>`;
    }

    openAsset(file: string) {
        const contentType = ASSET_TYPES[file];
        if (!contentType) throw notFound();
        const path = join(this.assetRoot, file);
        if (!existsSync(path)) throw notFound();
        return { stream: createReadStream(path), contentType };
    }
}
