/** Review state does not gate basic access. Only an explicit suspension revokes it. */
export function hasOpenPlatformAccess(status: string | null | undefined) {
    return status == null || ["approved", "pending", "rejected"].includes(status);
}
