import { Box, CloseButton, Modal } from '@mantine/core';

interface IImageLightboxProps {
  src: string | null;
  onClose: () => void;
}

const ImageLightbox = ({ src, onClose }: IImageLightboxProps) => (
  <Modal
    opened={!!src}
    onClose={onClose}
    withCloseButton={false}
    padding={0}
    size="auto"
    centered
    radius="md"
    classNames={{ content: 'image-lightbox__content' }}
  >
    {src && (
      <Box pos="relative">
        <img src={src} alt="" className="image-lightbox__image" />
        <CloseButton
          size="lg"
          radius="xl"
          pos="absolute"
          top={-14}
          right={-14}
          className="image-lightbox__close"
          onClick={onClose}
        />
      </Box>
    )}
  </Modal>
);

export default ImageLightbox;
