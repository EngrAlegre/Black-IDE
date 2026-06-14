import sys
from PIL import Image

logo_path = r'D:\Alegre\June 2026 AI\logo.jpg'
out_ico = r'D:\Alegre\June 2026 AI\black-ide\resources\win32\code.ico'
out_150 = r'D:\Alegre\June 2026 AI\black-ide\resources\win32\code_150x150.png'
out_70 = r'D:\Alegre\June 2026 AI\black-ide\resources\win32\code_70x70.png'

img = Image.open(logo_path).convert('RGBA')

# Generate ICO with multiple sizes
icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
img.save(out_ico, format='ICO', sizes=icon_sizes)

# Generate PNGs
img.resize((150, 150)).save(out_150, format='PNG')
img.resize((70, 70)).save(out_70, format='PNG')

print('Icons generated successfully!')
