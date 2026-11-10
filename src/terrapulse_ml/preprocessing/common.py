
import numpy as np
from scipy.ndimage import median_filter, distance_transform_edt


def power_to_db(image, valid_mask=None):

    image = np.asarray(image, dtype=np.float32)

    if valid_mask is None:
        valid_mask = np.ones(image.shape, dtype=bool)

    valid = (
        valid_mask
        & np.isfinite(image)
        & (image > 0)
    )

    db = np.full(image.shape, np.nan, dtype=np.float32)

    db[valid] = 10 * np.log10(image[valid])

    return db


def remove_speckle(image_db, kernel_size=3):

    if kernel_size < 1 or kernel_size % 2 == 0:
        raise ValueError("Kernel size must be a positive odd number")

    valid = np.isfinite(image_db)

    if not valid.any():
        raise ValueError("No valid pixels")

    # Temporarily fill invalid pixels from nearest valid pixels
    nearest = distance_transform_edt(
        ~valid,
        return_distances=False,
        return_indices=True
    )

    filled = image_db[tuple(nearest)]

    # Simple median filter baseline
    filtered = median_filter(
        filled,
        size=kernel_size,
        mode="nearest"
    ).astype(np.float32)

    # Restore invalid pixels
    filtered[~valid] = np.nan

    return filtered
