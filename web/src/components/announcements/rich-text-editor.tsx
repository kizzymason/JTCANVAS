import { App } from "antd";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import { AlignCenter, AlignLeft, AlignRight, Bold, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/services/api/client";
import { cn } from "@/lib/utils";

type RichTextEditorProps = {
    value: string;
    onChange: (html: string) => void;
    onUploadImage: (file: File) => Promise<string>;
    contentKey?: string;
    placeholder?: string;
    disabled?: boolean;
};

function ToolbarButton({
    active,
    disabled,
    label,
    onClick,
    children,
}: {
    active?: boolean;
    disabled?: boolean;
    label: string;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            className={cn(
                "inline-flex size-8 items-center justify-center rounded-md text-stone-600 transition hover:bg-black/5 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white",
                active && "bg-black/10 text-stone-950 dark:bg-white/15 dark:text-white",
            )}
            aria-label={label}
            title={label}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

export function RichTextEditor({ value, onChange, onUploadImage, contentKey, placeholder, disabled }: RichTextEditorProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const uploading = useRef(false);
    const editorRef = useRef<Editor | null>(null);
    const onUploadImageRef = useRef(onUploadImage);
    const messageRef = useRef(message);
    const tRef = useRef(t);
    onUploadImageRef.current = onUploadImage;
    messageRef.current = message;
    tRef.current = t;

    const insertUploadedImage = async (file: File) => {
        const instance = editorRef.current;
        if (!instance || uploading.current) return;
        uploading.current = true;
        try {
            const url = await onUploadImageRef.current(file);
            instance.chain().focus().setImage({ src: url, alt: file.name }).run();
        } catch (error) {
            messageRef.current.error(error instanceof ApiError ? error.message : tRef.current("admin.saveFailed"));
        } finally {
            uploading.current = false;
        }
    };

    const editor = useEditor({
        immediatelyRender: false,
        shouldRerenderOnTransaction: true,
        editable: !disabled,
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
                link: false,
            }),
            Image.configure({ allowBase64: false }),
            Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
            Placeholder.configure({ placeholder: placeholder || t("admin.announcements.editorPlaceholder") }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
        ],
        content: value || "<p></p>",
        onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
        editorProps: {
            handlePaste(_view, event) {
                const file = imageFileFromList(event.clipboardData?.files);
                if (!file) return false;
                void insertUploadedImage(file);
                return true;
            },
            handleDrop(_view, event) {
                const file = imageFileFromList(event.dataTransfer?.files);
                if (!file) return false;
                event.preventDefault();
                void insertUploadedImage(file);
                return true;
            },
        },
    });
    editorRef.current = editor;

    useEffect(() => {
        if (!editor) return;
        editor.setEditable(!disabled);
    }, [disabled, editor]);

    useEffect(() => {
        if (!editor) return;
        editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
        // Reset only when the parent opens a different announcement.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor, contentKey]);

    const state = useEditorState({
        editor,
        selector: (snapshot) => ({
            bold: snapshot.editor?.isActive("bold") ?? false,
            italic: snapshot.editor?.isActive("italic") ?? false,
            underline: snapshot.editor?.isActive("underline") ?? false,
            strike: snapshot.editor?.isActive("strike") ?? false,
            heading: snapshot.editor?.isActive("heading", { level: 2 }) ?? false,
            bullet: snapshot.editor?.isActive("bulletList") ?? false,
            ordered: snapshot.editor?.isActive("orderedList") ?? false,
            quote: snapshot.editor?.isActive("blockquote") ?? false,
            left: snapshot.editor?.isActive({ textAlign: "left" }) ?? false,
            center: snapshot.editor?.isActive({ textAlign: "center" }) ?? false,
            right: snapshot.editor?.isActive({ textAlign: "right" }) ?? false,
            link: snapshot.editor?.isActive("link") ?? false,
        }),
    });

    const insertImage = () => {
        if (!editor || uploading.current) return;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp,image/gif";
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) void insertUploadedImage(file);
        };
        input.click();
    };

    const insertLink = () => {
        if (!editor) return;
        const previous = editor.getAttributes("link").href as string | undefined;
        const next = window.prompt(t("admin.announcements.linkPrompt"), previous || "https://");
        if (next === null) return;
        const href = next.trim();
        if (!href) {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
        }
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    };

    return (
        <div className={cn("overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950", disabled && "opacity-70")}>
            <div className="flex flex-wrap items-center gap-0.5 border-b border-stone-200 px-1.5 py-1 dark:border-stone-700">
                <ToolbarButton active={state?.bold} disabled={!editor} label={t("admin.announcements.toolbar.bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
                    <Bold className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.italic} disabled={!editor} label={t("admin.announcements.toolbar.italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
                    <Italic className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.underline} disabled={!editor} label={t("admin.announcements.toolbar.underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
                    <Underline className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.strike} disabled={!editor} label={t("admin.announcements.toolbar.strike")} onClick={() => editor?.chain().focus().toggleStrike().run()}>
                    <Strikethrough className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.heading} disabled={!editor} label={t("admin.announcements.toolbar.heading")} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
                    <Heading2 className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.bullet} disabled={!editor} label={t("admin.announcements.toolbar.bullet")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
                    <List className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.ordered} disabled={!editor} label={t("admin.announcements.toolbar.ordered")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
                    <ListOrdered className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.quote} disabled={!editor} label={t("admin.announcements.toolbar.quote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
                    <Quote className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.left} disabled={!editor} label={t("admin.announcements.toolbar.alignLeft")} onClick={() => editor?.chain().focus().setTextAlign("left").run()}>
                    <AlignLeft className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.center} disabled={!editor} label={t("admin.announcements.toolbar.alignCenter")} onClick={() => editor?.chain().focus().setTextAlign("center").run()}>
                    <AlignCenter className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.right} disabled={!editor} label={t("admin.announcements.toolbar.alignRight")} onClick={() => editor?.chain().focus().setTextAlign("right").run()}>
                    <AlignRight className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton active={state?.link} disabled={!editor} label={t("admin.announcements.toolbar.link")} onClick={insertLink}>
                    <Link2 className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton disabled={!editor} label={t("admin.announcements.toolbar.image")} onClick={insertImage}>
                    <ImagePlus className="size-3.5" />
                </ToolbarButton>
                <span className="mx-1 h-4 w-px bg-stone-200 dark:bg-stone-700" />
                <ToolbarButton disabled={!editor} label={t("admin.announcements.toolbar.undo")} onClick={() => editor?.chain().focus().undo().run()}>
                    <Undo2 className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton disabled={!editor} label={t("admin.announcements.toolbar.redo")} onClick={() => editor?.chain().focus().redo().run()}>
                    <Redo2 className="size-3.5" />
                </ToolbarButton>
            </div>
            <EditorContent editor={editor} className="announcement-editor" />
        </div>
    );
}

function imageFileFromList(files: FileList | undefined | null) {
    return [...(files ?? [])].find((file) => /^(image\/jpeg|image\/png|image\/webp|image\/gif)$/i.test(file.type)) ?? null;
}
