#!/usr/bin/env python3
"""Regenerate the synthesized binary fixtures in test/fixtures/.

    python3 scripts/make-fixtures.py

These files are small, hand-built containers rather than application-authored
documents -- there is no Office install in CI and a real .xlsx is megabytes of
irrelevant XML. What matters is that they are genuine where libmagic actually
looks: real magic bytes, real CRCs, and (for OOXML/ODF) real zip containers with
the entry names and *ordering* that libmagic keys on.

Output is byte-deterministic: every zip entry, gzip header and tar header has a
pinned timestamp and pinned ownership. Re-running this must produce no diff, so
a fixture change is always a deliberate, reviewable change.
"""
import os
import struct
import sys
import tarfile
import zipfile
import zlib
import io

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(os.path.dirname(HERE), 'test', 'fixtures')

# Pinned so output is reproducible. Zip's epoch starts at 1980.
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)


def write(name, data):
    if isinstance(data, str):
        data = data.encode('utf-8')
    with open(os.path.join(FIX, name), 'wb') as fh:
        fh.write(data)
    return name


def zip_entry(zf, name, data, stored=False):
    """Add one entry with a pinned timestamp (writestr alone uses time.now())."""
    zi = zipfile.ZipInfo(name, date_time=ZIP_EPOCH)
    zi.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
    zi.external_attr = (0o644 & 0xFFFF) << 16
    zf.writestr(zi, data)


# --------------------------------------------------------------------- CSV set
# Signature-free text is the case that matters most: a CSV has no magic bytes,
# so libmagic classifies it purely by its text heuristics and encoding sniffing.
ROWS = 'order_id,outlet,item,qty,amount\n' + ''.join(
    'ORD%08d,Koramangala,Masala Dosa,%d,%d.00\n' % (i, i % 4 + 1, i * 60)
    for i in range(40))

write('csv-crlf.csv', ROWS.replace('\n', '\r\n'))
write('csv-utf8-bom.csv', b'\xef\xbb\xbf' + ROWS.encode())
write('csv-utf16.csv', ROWS.encode('utf-16'))          # utf-16 codec emits a BOM
write('csv-semicolon.csv', ROWS.replace(',', ';'))
write('csv-quoted.csv',
      'id,note,amt\n1,"line one\nline two",10\n2,"has ""quotes"" inside",20\n')
write('csv-numeric.csv', ''.join('%d,%d,%d\n' % (i, i * 2, i * 3)
                                 for i in range(60)))

# ------------------------------------------------------------- text-ish markup
write('html.html', '<!DOCTYPE html>\n<html><head><title>t</title></head>'
                   '<body><p>hi</p></body></html>\n')
write('svg.svg', '<?xml version="1.0"?>\n'
                 '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">'
                 '<rect width="8" height="8"/></svg>\n')

# ------------------------------------------------------------------- images
def png_bytes():
    """1x1 8-bit greyscale PNG with real zlib IDAT and real CRCs."""
    def chunk(tag, payload):
        body = tag + payload
        return (struct.pack('>I', len(payload)) + body
                + struct.pack('>I', zlib.crc32(body) & 0xffffffff))
    ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 0, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(b'\x00\x00'))
            + chunk(b'IEND', b''))


# GIF: same 1x1 payload under both header versions, so the test proves libmagic
# recognises 87a as well as the ubiquitous 89a.
GIF89A = (b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff'
          b'!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00'
          b'\x00\x02\x02\x44\x01\x00;')
write('gif89a.gif', GIF89A)
write('gif87a.gif', b'GIF87a' + GIF89A[6:])

# BMP: 1x1 24-bit with a correct BITMAPINFOHEADER.
BMP_PIXELS = b'\x00\x00\xff\x00'
BMP = (b'BM' + struct.pack('<IHHI', 14 + 40 + len(BMP_PIXELS), 0, 0, 54)
       + struct.pack('<IiiHHIIiiII', 40, 1, 1, 1, 24, 0, len(BMP_PIXELS),
                     0, 0, 0, 0)
       + BMP_PIXELS)
write('bmp.bmp', BMP)

# TIFF: little-endian header plus a single IFD entry.
write('tiff.tif', b'II*\x00' + struct.pack('<I', 8) + struct.pack('<H', 1)
                  + struct.pack('<HHII', 256, 3, 1, 1) + struct.pack('<I', 0))

# WebP: RIFF container with a VP8 chunk.
VP8 = b'\x30\x01\x00\x9d\x01\x2a\x01\x00\x01\x00'
write('webp.webp', b'RIFF' + struct.pack('<I', 4 + 8 + len(VP8)) + b'WEBP'
                   + b'VP8 ' + struct.pack('<I', len(VP8)) + VP8)

# ICO: one 1x1 directory entry pointing at the BMP payload above.
ICO_IMAGE = BMP[14:]
write('ico.ico', b'\x00\x00\x01\x00\x01\x00'
                 + struct.pack('<BBBBHHII', 1, 1, 0, 0, 1, 24,
                               len(ICO_IMAGE), 22)
                 + ICO_IMAGE)

# -------------------------------------------------------- OOXML: xlsx/docx/pptx
# libmagic needs [Content_Types].xml as the FIRST entry, then distinguishes the
# three by the xl/ , word/ or ppt/ prefix. Real Office writes it first too; a
# package that does not is only detectable as application/zip.
OOXML = {
    'xlsx': ('xl/workbook.xml',
             'application/vnd.openxmlformats-officedocument'
             '.spreadsheetml.sheet.main+xml',
             '<workbook xmlns="http://schemas.openxmlformats.org/'
             'spreadsheetml/2006/main"><sheets/></workbook>'),
    'docx': ('word/document.xml',
             'application/vnd.openxmlformats-officedocument'
             '.wordprocessingml.document.main+xml',
             '<w:document xmlns:w="http://schemas.openxmlformats.org/'
             'wordprocessingml/2006/main"><w:body/></w:document>'),
    'pptx': ('ppt/presentation.xml',
             'application/vnd.openxmlformats-officedocument'
             '.presentationml.presentation.main+xml',
             '<p:presentation xmlns:p="http://schemas.openxmlformats.org/'
             'presentationml/2006/main"/>'),
}

for ext, (part, ctype, body) in OOXML.items():
    with zipfile.ZipFile(os.path.join(FIX, ext + '.' + ext), 'w') as zf:
        zip_entry(zf, '[Content_Types].xml',
                  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                  '<Types xmlns="http://schemas.openxmlformats.org/package/'
                  '2006/content-types">'
                  '<Default Extension="rels" ContentType="application/'
                  'vnd.openxmlformats-package.relationships+xml"/>'
                  '<Default Extension="xml" ContentType="application/xml"/>'
                  '<Override PartName="/%s" ContentType="%s"/></Types>'
                  % (part, ctype))
        zip_entry(zf, '_rels/.rels',
                  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                  '<Relationships xmlns="http://schemas.openxmlformats.org/'
                  'package/2006/relationships"><Relationship Id="rId1" '
                  'Type="http://schemas.openxmlformats.org/officeDocument/'
                  '2006/relationships/officeDocument" Target="%s"/>'
                  '</Relationships>' % part)
        zip_entry(zf, part,
                  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                  + body)

# --------------------------------------------------------------- ODF: ods / odt
# ODF requires 'mimetype' as the first entry, STORED uncompressed, holding the
# media type as plain text. That is exactly what libmagic reads.
for ext, mime in (('ods', 'application/vnd.oasis.opendocument.spreadsheet'),
                  ('odt', 'application/vnd.oasis.opendocument.text')):
    with zipfile.ZipFile(os.path.join(FIX, ext + '.' + ext), 'w') as zf:
        zip_entry(zf, 'mimetype', mime, stored=True)
        zip_entry(zf, 'META-INF/manifest.xml',
                  '<?xml version="1.0"?><manifest:manifest xmlns:manifest='
                  '"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>')
        zip_entry(zf, 'content.xml', '<?xml version="1.0"?><office/>')

# -------------------------------------------------------------------- archives
# tar exists to pin the MAGIC_MIME_ENCODING quirk -- see test/test-mime.js.
tar_buf = io.BytesIO()
with tarfile.open(fileobj=tar_buf, mode='w', format=tarfile.USTAR_FORMAT) as tf:
    info = tarfile.TarInfo('a.txt')
    info.size = 6
    info.mtime = 0
    info.uid = info.gid = 0
    info.uname = info.gname = ''
    tf.addfile(info, io.BytesIO(b'hello\n'))
write('tar.tar', tar_buf.getvalue())

# gzip with mtime pinned to 0; the header otherwise embeds the current time.
gz_buf = io.BytesIO()
with __import__('gzip').GzipFile(fileobj=gz_buf, mode='wb', mtime=0) as gz:
    gz.write(ROWS.encode())
write('gzip.gz', gz_buf.getvalue())

print('regenerated fixtures in %s' % FIX)
