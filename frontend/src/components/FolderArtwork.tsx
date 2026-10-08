export function FolderArtwork({ className = '' }: { className?: string }) {
  return (
    <picture className={`folder-artwork ${className}`}>
      <source
        type="image/webp"
        srcSet="/images/document-folder-200.webp 200w, /images/document-folder-480.webp 480w"
        sizes="(max-width: 640px) 200px, 480px"
      />
      <img
        className="h-full w-full object-contain"
        src="/images/document-folder-480.webp"
        alt=""
        aria-hidden="true"
        width="480"
        height="480"
        decoding="async"
        loading={className.includes('card-folder') ? 'lazy' : 'eager'}
      />
    </picture>
  )
}
