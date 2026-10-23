import unittest
import numpy as np
from extract_frames import remove_green


class GreenMatteTests(unittest.TestCase):
    def test_background_becomes_fully_transparent(self):
        image = np.full((40, 80, 3), (43, 190, 39), dtype=np.uint8)
        rgba = remove_green(image)
        self.assertTrue(np.all(rgba[:, :, 3] == 0))
        self.assertTrue(np.all(rgba[:, :, :3] == 0))

    def test_white_suit_cards_and_dark_blue_are_preserved(self):
        image = np.full((100, 100, 3), (43, 190, 39), dtype=np.uint8)
        image[30:50, 30:50] = (250, 250, 245)
        image[50:70, 30:50] = (20, 40, 90)
        rgba = remove_green(image)
        self.assertTrue(np.all(rgba[30:70, 30:50, 3] == 255))
        np.testing.assert_array_equal(rgba[35, 35, :3], image[35, 35])
        np.testing.assert_array_equal(rgba[55, 35, :3], image[55, 35])

    def test_green_edge_is_soft_and_despilled(self):
        image = np.full((100, 100, 3), (43, 190, 39), dtype=np.uint8)
        image[30:70, 30:70] = (100, 170, 100)
        rgba = remove_green(image)
        pixel = rgba[50, 50]
        self.assertGreater(pixel[3], 0)
        self.assertLess(pixel[3], 255)
        self.assertLessEqual(int(pixel[1]), max(int(pixel[0]), int(pixel[2])) + 4)

    def test_detached_white_feathers_are_not_discarded(self):
        image = np.full((100, 100, 3), (43, 190, 39), dtype=np.uint8)
        image[15:20, 15:22] = 255
        image[60:80, 60:80] = (230, 230, 230)
        rgba = remove_green(image)
        self.assertTrue(np.all(rgba[15:20, 15:22, 3] == 255))
        self.assertTrue(np.all(rgba[60:80, 60:80, 3] == 255))


if __name__ == '__main__':
    unittest.main()
