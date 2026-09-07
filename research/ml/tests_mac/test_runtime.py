"""Explicit native-runtime checks. Run separately; no model weights are loaded."""
import platform
import unittest


@unittest.skipUnless(platform.system() == 'Darwin' and platform.machine() == 'arm64',
                     'Native Apple Silicon runtime only')
class NativeRuntimeTests(unittest.TestCase):
    def test_metal_executes_a_small_array(self):
        import mlx.core as mx
        self.assertTrue(mx.metal.is_available())
        with mx.stream(mx.gpu):
            result = mx.sum(mx.array([1.0, 2.0, 3.0]) ** 2)
            mx.eval(result)
        self.assertEqual(result.item(), 14.0)


if __name__ == '__main__': unittest.main()
