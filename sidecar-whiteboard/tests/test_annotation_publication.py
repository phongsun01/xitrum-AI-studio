"""Atomic no-overwrite publication protects existing custom and versioned files."""
import json
from pathlib import Path
import errno
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from whiteboard_runner import save_annotation_output


class AnnotationPublicationTests(unittest.TestCase):
    def test_new_file_is_published_and_temporary_file_removed(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / 'custom.v3.annotation.json'
            save_annotation_output({'sceneId':'scene-1'}, str(target), False)
            self.assertEqual(json.loads(target.read_text()), {'sceneId':'scene-1'})
            self.assertEqual(list(Path(d).iterdir()), [target])

    def test_existing_file_is_never_replaced_in_no_overwrite_mode(self):
        for name in ['custom.json','scene.v2.annotation.json']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                target = Path(d) / name
                target.write_bytes(b'manual edits')
                with self.assertRaisesRegex(ValueError, 'ANNOTATION_EXISTS'):
                    save_annotation_output({'sceneId':'new'}, str(target), False)
                self.assertEqual(target.read_bytes(), b'manual edits')
                self.assertEqual(list(Path(d).iterdir()), [target])

    def test_explicit_overwrite_keeps_existing_single_scene_contract(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / 'old.json'
            target.write_text('old')
            save_annotation_output({'new':True}, str(target), True)
            self.assertEqual(json.loads(target.read_text()), {'new':True})

    def test_filesystem_without_hard_links_still_publishes_without_overwriting(self):
        # exFAT/FAT32 trên ổ ngoài không hỗ trợ os.link: không được làm hỏng việc tạo annotation mới.
        with tempfile.TemporaryDirectory() as d:
            fresh, existing = Path(d) / 'new.json', Path(d) / 'keep.json'
            existing.write_bytes(b'manual edits')
            with mock.patch('os.link', side_effect=OSError(errno.EPERM, 'no hard links')):
                save_annotation_output({'sceneId': 'n'}, str(fresh), False)
                with self.assertRaisesRegex(ValueError, 'ANNOTATION_EXISTS'):
                    save_annotation_output({'sceneId': 'x'}, str(existing), False)
            self.assertEqual(json.loads(fresh.read_text()), {'sceneId': 'n'})
            self.assertEqual(existing.read_bytes(), b'manual edits')
            self.assertEqual(sorted(p.name for p in Path(d).iterdir()), ['keep.json', 'new.json'])


if __name__ == '__main__': unittest.main()
