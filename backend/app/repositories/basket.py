"""
Basket repository — owns all SQLAlchemy Session access for the Basket domain
(Basket, BasketConstituent, BasketNav). Services call these functions and never
touch Session directly for this domain (AD-1).
"""
from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.basket import Basket, BasketConstituent, BasketNav


def create_basket(
    db: Session,
    name: str,
    user_id: int | None,
    weighting_method: str,
    constituents: list[dict],
    effective_date: date,
) -> Basket:
    """Creates a Basket and its initial BasketConstituent weight-set in one transaction."""
    basket = Basket(name=name, user_id=user_id, weighting_method=weighting_method)
    db.add(basket)
    db.flush()  # assigns basket.id without committing yet

    for c in constituents:
        db.add(BasketConstituent(
            basket_id=basket.id,
            ticker=c["ticker"],
            effective_date=effective_date,
            weight=c["weight"],
        ))

    db.commit()
    db.refresh(basket)
    return basket


def update_basket(
    db: Session,
    basket: Basket,
    name: str,
    weighting_method: str,
    constituents: list[dict],
    effective_date: date,
) -> Basket:
    """
    Updates name/weighting_method and inserts a NEW BasketConstituent weight-set effective
    `effective_date` (AD-8: an edit never rewrites or removes a *prior, already-effective*
    weight-set, and never touches BasketNav — only a future daily job reads the new set once
    its date arrives). Any not-yet-effective set already pending for this same `effective_date`
    (e.g. a second edit made the same day, before the first one has taken effect) is replaced
    outright rather than merged — AD-8 only protects weight-sets whose date has already passed.
    """
    db.query(BasketConstituent).filter_by(basket_id=basket.id, effective_date=effective_date).delete()

    basket.name = name
    basket.weighting_method = weighting_method

    for c in constituents:
        db.add(BasketConstituent(
            basket_id=basket.id,
            ticker=c["ticker"],
            effective_date=effective_date,
            weight=c["weight"],
        ))

    db.commit()
    db.refresh(basket)
    return basket


def add_nav_row(db: Session, basket_id: int, nav_date: date, index_level: float) -> BasketNav:
    """Writes exactly one BasketNav row. AD-8: creation's day-zero row is the only synchronous writer."""
    nav = BasketNav(basket_id=basket_id, date=nav_date, index_level=index_level)
    db.add(nav)
    db.commit()
    db.refresh(nav)
    return nav


def list_baskets(db: Session, user_id: int) -> list[Basket]:
    """Returns system/global Baskets (user_id IS NULL) plus the current user's own Baskets."""
    return (
        db.query(Basket)
        .filter(or_(Basket.user_id == user_id, Basket.user_id.is_(None)))
        .order_by(Basket.created_at.desc())
        .all()
    )


def get_basket(db: Session, basket_id: int) -> Basket | None:
    return db.get(Basket, basket_id)


def get_current_constituents(db: Session, basket_id: int) -> list[BasketConstituent]:
    """The weight-set with the latest effective_date (only one exists until a Story 1.3 edit)."""
    rows = db.query(BasketConstituent).filter_by(basket_id=basket_id).all()
    if not rows:
        return []
    latest = max(r.effective_date for r in rows)
    return [r for r in rows if r.effective_date == latest]


def last_two_navs_by_basket(db: Session, basket_ids: list[int]) -> dict[int, list[BasketNav]]:
    """Latest two BasketNav rows per basket (most recent first) — the minimum needed for a day-over-day change."""
    if not basket_ids:
        return {}
    rows = (
        db.query(BasketNav)
        .filter(BasketNav.basket_id.in_(basket_ids))
        .order_by(BasketNav.basket_id, BasketNav.date.desc())
        .all()
    )
    by_basket: dict[int, list[BasketNav]] = {}
    for row in rows:
        bucket = by_basket.setdefault(row.basket_id, [])
        if len(bucket) < 2:
            bucket.append(row)
    return by_basket
