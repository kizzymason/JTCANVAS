import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageDriver, type DownloadTarget, type StoredObject } from "./storage.driver";

export type S3DriverOptions = {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    /** Set when a CDN fronts the bucket; lets us skip signing entirely for public objects. */
    publicBaseUrl: string;
    signedUrlTtlSeconds: number;
};

export class S3StorageDriver extends StorageDriver {
    readonly name = "s3" as const;
    private readonly client: S3Client;

    constructor(private readonly options: S3DriverOptions) {
        super();
        this.client = new S3Client({
            region: options.region,
            endpoint: options.endpoint || undefined,
            forcePathStyle: options.forcePathStyle,
            credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
        });
    }

    async put(objectPath: string, body: Buffer, mimeType: string): Promise<StoredObject> {
        await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: objectPath, Body: body, ContentType: mimeType || "application/octet-stream" }));
        return { objectPath, bytes: body.byteLength, mimeType };
    }

    async get(objectPath: string) {
        const response = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: objectPath }));
        return Buffer.from(await response.Body!.transformToByteArray());
    }

    async delete(objectPath: string) {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectPath }));
    }

    async download(objectPath: string, mimeType: string, fileName?: string): Promise<DownloadTarget> {
        if (this.options.publicBaseUrl) return { kind: "redirect", url: `${this.options.publicBaseUrl.replace(/\/+$/, "")}/${objectPath}` };
        const command = new GetObjectCommand({
            Bucket: this.options.bucket,
            Key: objectPath,
            ResponseContentType: mimeType || undefined,
            ResponseContentDisposition: fileName ? `attachment; filename="${encodeURIComponent(fileName)}"` : undefined,
        });
        return { kind: "redirect", url: await getSignedUrl(this.client, command, { expiresIn: this.options.signedUrlTtlSeconds }) };
    }

    destroy() {
        this.client.destroy();
    }
}
