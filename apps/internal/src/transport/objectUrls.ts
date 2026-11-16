export type ObjectUrlFactory = {
  create(blob: Blob): string;
  revoke(url: string): void;
};

export const browserObjectUrls: ObjectUrlFactory = {
  create(blob) {
    return URL.createObjectURL(blob);
  },
  revoke(url) {
    URL.revokeObjectURL(url);
  },
};
