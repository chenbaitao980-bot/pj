# 品牌素材处理：把 assets/source-face.jpg 做成插件图标，source-whale.jpg 做成 README 封面。
# 用法：python tests/lib/make-brand-assets.py（在仓库根目录跑）
# 输出：assets/icon.webp（裁到主体）、assets/icon-full.webp（整幅）、assets/hero.{zh,en}.png（2080 宽）
from PIL import Image, ImageDraw


def rounded(img):
    """8 倍超采样画圆角 104px（最终 448 尺寸），WebP 无损。"""
    S = img.width
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, S - 1, S - 1), radius=int(S * 104 / 448), fill=255
    )
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def main():
    # 插件图标：脸是主体，裁中间 88% 让缩略图里认得出
    face = Image.open('assets/source-face.jpg').convert('RGB')
    S = face.width
    full = face.resize((448, 448), Image.LANCZOS)
    rounded(full).save('assets/icon-full.webp', 'WEBP', lossless=True, quality=100, method=6)

    side = int(S * 0.88)
    left = (S - side) // 2
    icon = face.crop((left, left, left + side, left + side)).resize((448, 448), Image.LANCZOS)
    rounded(icon).save('assets/icon.webp', 'WEBP', lossless=True, quality=100, method=6)

    # README 封面：2080 宽（GitHub 显示一半），16:9 保持原比例
    whale = Image.open('assets/source-whale.jpg').convert('RGB')
    w2 = 2080
    h2 = int(whale.height * w2 / whale.width)
    hero = whale.resize((w2, h2), Image.LANCZOS)
    hero.save('assets/hero.zh.png', 'PNG')
    hero.save('assets/hero.en.png', 'PNG')
    print('done:', full.size, icon.size, hero.size)


if __name__ == '__main__':
    main()
