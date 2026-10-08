import React from "react";

type TestImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  readonly fill?: boolean;
  readonly priority?: boolean;
  readonly unoptimized?: boolean;
};

export default function TestNextImage({ fill = false, priority = false, unoptimized = false, ...props }: TestImageProps) {
  return React.createElement("img", {
    ...props,
    "data-next-image": "true",
    "data-fill": fill ? "true" : undefined,
    "data-priority": priority ? "true" : undefined,
    "data-unoptimized": unoptimized ? "true" : undefined,
  });
}
