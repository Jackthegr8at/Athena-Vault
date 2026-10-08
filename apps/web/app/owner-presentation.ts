export function ownerDisplayLabel(owner: { readonly displayName: string | null; readonly email: string }): string {
  return owner.displayName || owner.email.split("@")[0] || owner.email;
}
