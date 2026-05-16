import { Composition } from "remotion";
import { PassChickLogoReveal } from "./LogoReveal";

export const RemotionRoot = () => {
  return (
    <Composition
      id="PassChickLogoReveal"
      component={PassChickLogoReveal}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
