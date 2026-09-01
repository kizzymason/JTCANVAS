import { describe, expect, it } from "vitest";
import { AppError } from "../../../common/errors";
import type { ReferenceInput } from "./provider.types";
import {
    assertPiapiReferences,
    ephemeralFileData,
    ephemeralFileName,
    ephemeralUploadUrl,
    PIAPI_MAX_REFERENCE_IMAGES,
    piapiSeedreamInput,
} from "./piapi-references";

function ref(overrides: Partial<ReferenceInput> = {}): ReferenceInput {
    return {
        storageKey: "image:test",
        mimeType: "image/png",
        fileName: "ref.png",
        body: Buffer.from("png-bytes"),
        ...overrides,
    };
}

function errorBody(error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).getResponse() as { code: string; message: string };
}

describe("PiAPI reference hosting", () => {
    it("omits image_urls for text-to-image and forwards public URLs in order for edits", () => {
        expect(piapiSeedreamInput({ prompt: "a cat", aspectRatio: "1:1", size: "1K", outputFormat: "png", imageUrls: [] })).toEqual({
            prompt: "a cat",
            aspect_ratio: "1:1",
            output_format: "png",
            size: "1K",
        });
        expect(
            piapiSeedreamInput({
                prompt: "edit",
                aspectRatio: "16:9",
                size: "2K",
                outputFormat: "png",
                imageUrls: ["https://cdn.example/a.png", "https://cdn.example/b.jpg"],
            }).image_urls,
        ).toEqual(["https://cdn.example/a.png", "https://cdn.example/b.jpg"]);
    });

    it("normalises upload file names to a PiAPI-supported extension matching the MIME type", () => {
        expect(ephemeralFileName("photo.JPEG", "image/jpeg")).toBe("photo.jpg");
        expect(ephemeralFileName("clip", "image/webp")).toBe("clip.webp");
        expect(ephemeralFileName("image:abc", "image/png")).toBe("image_abc.png");
        expect(ephemeralFileData(Buffer.from("hi"), "image/jpg")).toBe("data:image/jpeg;base64,aGk=");
    });

    it("reads a public URL out of the ephemeral upload envelope", () => {
        expect(ephemeralUploadUrl({ code: 200, data: { url: "https://upload.theapi.app/x.png" }, message: "success" })).toBe(
            "https://upload.theapi.app/x.png",
        );
        expect(errorBody(catchError(() => ephemeralUploadUrl({ code: 403, data: { url: "" }, message: "Insufficient plan level" })))).toMatchObject({
            code: "PIAPI_UPLOAD_FAILED",
        });
    });

    it("rejects masks, more than ten references, oversized files and unsupported types before any upload", () => {
        expect(errorBody(catchError(() => assertPiapiReferences([], ref())))).toMatchObject({ code: "PIAPI_MASK_UNSUPPORTED" });
        expect(errorBody(catchError(() => assertPiapiReferences(Array.from({ length: PIAPI_MAX_REFERENCE_IMAGES + 1 }, () => ref()))))).toMatchObject({
            code: "PIAPI_TOO_MANY_REFERENCES",
        });
        expect(errorBody(catchError(() => assertPiapiReferences([ref({ body: Buffer.alloc(10 * 1024 * 1024 + 1) })])))).toMatchObject({
            code: "PIAPI_REFERENCE_TOO_LARGE",
        });
        expect(errorBody(catchError(() => assertPiapiReferences([ref({ mimeType: "image/gif", fileName: "a.gif" })])))).toMatchObject({
            code: "PIAPI_REFERENCE_TYPE",
        });
        expect(() => assertPiapiReferences([ref(), ref({ fileName: "two.jpg", mimeType: "image/jpeg" })])).not.toThrow();
    });
});

function catchError(run: () => void) {
    try {
        run();
        throw new Error("expected throw");
    } catch (error) {
        return error;
    }
}
