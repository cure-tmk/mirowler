# Fixtures

Anonymized reductions of a real product page. Everything identifying (site, brand, product, ids, links, form secrets, scripts, images) is removed; only the markup the selectors below need is kept.

## target-a

| File | State |
| --- | --- |
| `out-of-stock.html` | As observed: the active variation shows `在庫なし` and the cart button is inactive |
| `in-stock.html` | Synthesized, not observed: no `在庫なし` on the active variation and an enabled cart button |
| `missing-element.html` | Layout change: product name and price remain, the variation block and cart form are gone |
| `block-page.html` | A generic access-denied page with no product markup |

Selectors these fixtures are meant to keep working:

- Availability item: `a.block-variation--item.active` (its text contains `在庫なし` only when out of stock; absent on a layout change)
- Availability marker: `a.block-variation--item.active .block-variation--item-nostock` (absent both in stock and on a layout change)
- Cart button: `#goodsdetail_cart input.btn_cart_l_` (stock shows in the `value` attribute, readable with a `css_attr` extractor on `value`)
- Product name: `h1.goods_name_`
- Price: `.price_box_0 p.price_` (text like `123,456円（税込）`, which the `jpy` parser reads as 123456)

## Monitor config used in tests

- Extractor: `css_attr` on `#goodsdetail_cart input.btn_cart_l_`, attribute `value`, parse `text`
- Evaluator: `rule` with `contains` `カートに入れる`, trigger `on_enter`
- Only the positive marker counts as `matched`; the absence of `在庫なし` alone never does, because it is also absent on a layout change or a block page
