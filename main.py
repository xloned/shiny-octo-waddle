from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Any, Optional, List, Dict

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    delete,
    func,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

from aiogram import Bot, Dispatcher, Router
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo


logging.basicConfig(level=logging.INFO)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/tgapp")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEBAPP_URL = os.getenv("WEBAPP_URL") or os.getenv("BASE_URL") or "http://localhost:8000"

WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
WEB_PORT = int(os.getenv("WEB_PORT", "8000"))


class Base(DeclarativeBase):
    pass


class TgUser(Base):
    __tablename__ = "tg_user"

    id: Mapped[int] = mapped_column(primary_key=True)
    tg_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    grids: Mapped[List["Grid"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    people: Mapped[List["Person"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Grid(Base):
    __tablename__ = "grid"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("tg_user.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    color: Mapped[Optional[str]] = mapped_column(String(32), default="#2d6cdf")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[TgUser] = relationship(back_populates="grids")
    people: Mapped[List["Person"]] = relationship(
        back_populates="grid",
        passive_deletes=True,
    )


class Person(Base):
    __tablename__ = "person"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("tg_user.id", ondelete="CASCADE"))
    grid_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("grid.id", ondelete="SET NULL"),
        nullable=True,
    )
    full_name: Mapped[str] = mapped_column(String(120))
    fields: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[TgUser] = relationship(back_populates="people")
    grid: Mapped[Optional[Grid]] = relationship(back_populates="people")


class NodePosition(Base):
    __tablename__ = "node_position"
    __table_args__ = (UniqueConstraint("user_id", "node_type", "node_id", name="uq_node_position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("tg_user.id", ondelete="CASCADE"), index=True)
    node_type: Mapped[str] = mapped_column(String(20))
    node_id: Mapped[int] = mapped_column(BigInteger)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session


async def get_or_create_user(session: AsyncSession, tg_id: int) -> TgUser:
    result = await session.execute(select(TgUser).where(TgUser.tg_id == tg_id))
    user = result.scalar_one_or_none()
    if user:
        return user
    user = TgUser(tg_id=tg_id)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        result = await session.execute(select(TgUser).where(TgUser.tg_id == tg_id))
        return result.scalar_one()
    await session.refresh(user)
    return user


class GridCreate(BaseModel):
    tg_id: int
    title: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = ""
    color: Optional[str] = "#2d6cdf"


class GridUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None
    color: Optional[str] = None


class GridOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    color: Optional[str]
    people_count: int


class PersonCreate(BaseModel):
    tg_id: int
    full_name: str = Field(..., min_length=1, max_length=120)
    fields: Dict[str, Any] = Field(default_factory=dict)
    grid_id: Optional[int] = None


class PersonUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    fields: Optional[Dict[str, Any]] = None
    grid_id: Optional[int] = None


class PersonOut(BaseModel):
    id: int
    full_name: str
    fields: Dict[str, Any]
    grid_id: Optional[int]


class PositionOut(BaseModel):
    node_type: str
    node_id: int
    x: float
    y: float


class PositionUpsert(BaseModel):
    tg_id: int
    node_type: str
    node_id: int
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.on_event("startup")
async def on_startup() -> None:
    await init_db()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/grids", response_model=List[GridOut])
async def list_grids(
    tg_id: int = Query(..., ge=1),
    session: AsyncSession = Depends(get_session),
) -> List[GridOut]:
    user = await get_or_create_user(session, tg_id)
    result = await session.execute(
        select(
            Grid.id,
            Grid.title,
            Grid.description,
            Grid.color,
            func.count(Person.id).label("people_count"),
        )
        .outerjoin(Person, Person.grid_id == Grid.id)
        .where(Grid.user_id == user.id)
        .group_by(Grid.id)
        .order_by(Grid.created_at.desc())
    )
    return [
        GridOut(
            id=row.id,
            title=row.title,
            description=row.description,
            color=row.color,
            people_count=row.people_count,
        )
        for row in result.all()
    ]


@app.post("/api/grids", response_model=GridOut)
async def create_grid(
    payload: GridCreate,
    session: AsyncSession = Depends(get_session),
) -> GridOut:
    user = await get_or_create_user(session, payload.tg_id)
    grid = Grid(
        user_id=user.id,
        title=payload.title.strip(),
        description=(payload.description or "").strip(),
        color=payload.color or "#2d6cdf",
    )
    session.add(grid)
    await session.commit()
    await session.refresh(grid)
    return GridOut(
        id=grid.id,
        title=grid.title,
        description=grid.description,
        color=grid.color,
        people_count=0,
    )


@app.put("/api/grids/{grid_id}", response_model=GridOut)
async def update_grid(
    grid_id: int,
    payload: GridUpdate,
    tg_id: int = Query(..., ge=1),
    session: AsyncSession = Depends(get_session),
) -> GridOut:
    user = await get_or_create_user(session, tg_id)
    result = await session.execute(select(Grid).where(Grid.id == grid_id, Grid.user_id == user.id))
    grid = result.scalar_one_or_none()
    if not grid:
        raise HTTPException(status_code=404, detail="Grid not found")
    if payload.title is not None:
        grid.title = payload.title.strip()
    if payload.description is not None:
        grid.description = payload.description.strip()
    if payload.color is not None:
        grid.color = payload.color
    await session.commit()

    count_result = await session.execute(
        select(func.count(Person.id)).where(Person.grid_id == grid.id)
    )
    people_count = count_result.scalar_one()
    return GridOut(
        id=grid.id,
        title=grid.title,
        description=grid.description,
        color=grid.color,
        people_count=people_count,
    )


@app.delete("/api/grids/{grid_id}")
async def delete_grid(
    grid_id: int,
    tg_id: int = Query(..., ge=1),
    session: AsyncSession = Depends(get_session),
) -> Dict[str, str]:
    user = await get_or_create_user(session, tg_id)
    result = await session.execute(select(Grid).where(Grid.id == grid_id, Grid.user_id == user.id))
    grid = result.scalar_one_or_none()
    if not grid:
        raise HTTPException(status_code=404, detail="Grid not found")

    await session.execute(update(Person).where(Person.grid_id == grid.id).values(grid_id=None))
    await session.execute(
        delete(NodePosition).where(
            NodePosition.user_id == user.id,
            NodePosition.node_type == "grid",
            NodePosition.node_id == grid.id,
        )
    )
    await session.delete(grid)
    await session.commit()
    return {"status": "deleted"}


@app.get("/api/people", response_model=List[PersonOut])
async def list_people(
    tg_id: int = Query(..., ge=1),
    grid_id: Optional[int] = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> List[PersonOut]:
    user = await get_or_create_user(session, tg_id)
    stmt = select(Person).where(Person.user_id == user.id)
    if grid_id is not None:
        stmt = stmt.where(Person.grid_id == grid_id)
    stmt = stmt.order_by(Person.created_at.desc())
    result = await session.execute(stmt)
    return [
        PersonOut(
            id=person.id,
            full_name=person.full_name,
            fields=person.fields or {},
            grid_id=person.grid_id,
        )
        for person in result.scalars().all()
    ]


@app.get("/api/positions", response_model=List[PositionOut])
async def list_positions(
    tg_id: int = Query(..., ge=1),
    session: AsyncSession = Depends(get_session),
) -> List[PositionOut]:
    user = await get_or_create_user(session, tg_id)
    result = await session.execute(
        select(NodePosition).where(NodePosition.user_id == user.id)
    )
    return [
        PositionOut(
            node_type=pos.node_type,
            node_id=pos.node_id,
            x=pos.x,
            y=pos.y,
        )
        for pos in result.scalars().all()
    ]


@app.post("/api/positions", response_model=PositionOut)
async def upsert_position(
    payload: PositionUpsert,
    session: AsyncSession = Depends(get_session),
) -> PositionOut:
    user = await get_or_create_user(session, payload.tg_id)
    if payload.node_type not in {"grid", "person"}:
        raise HTTPException(status_code=400, detail="Invalid node type")

    if payload.node_type == "grid":
        grid_result = await session.execute(
            select(Grid).where(Grid.id == payload.node_id, Grid.user_id == user.id)
        )
        if not grid_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Grid not found")
    else:
        person_result = await session.execute(
            select(Person).where(Person.id == payload.node_id, Person.user_id == user.id)
        )
        if not person_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Person not found")

    result = await session.execute(
        select(NodePosition).where(
            NodePosition.user_id == user.id,
            NodePosition.node_type == payload.node_type,
            NodePosition.node_id == payload.node_id,
        )
    )
    position = result.scalar_one_or_none()
    if position:
        position.x = payload.x
        position.y = payload.y
    else:
        position = NodePosition(
            user_id=user.id,
            node_type=payload.node_type,
            node_id=payload.node_id,
            x=payload.x,
            y=payload.y,
        )
        session.add(position)

    await session.commit()
    return PositionOut(
        node_type=position.node_type,
        node_id=position.node_id,
        x=position.x,
        y=position.y,
    )


@app.post("/api/people", response_model=PersonOut)
async def create_person(
    payload: PersonCreate,
    session: AsyncSession = Depends(get_session),
) -> PersonOut:
    user = await get_or_create_user(session, payload.tg_id)

    grid_id = payload.grid_id
    if grid_id is not None:
        grid_result = await session.execute(select(Grid).where(Grid.id == grid_id, Grid.user_id == user.id))
        if not grid_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Grid not found")

    person = Person(
        user_id=user.id,
        grid_id=grid_id,
        full_name=payload.full_name.strip(),
        fields=payload.fields or {},
    )
    session.add(person)
    await session.commit()
    await session.refresh(person)
    return PersonOut(
        id=person.id,
        full_name=person.full_name,
        fields=person.fields or {},
        grid_id=person.grid_id,
    )


@app.put("/api/people/{person_id}", response_model=PersonOut)
async def update_person(
    person_id: int,
    payload: PersonUpdate,
    tg_id: int = Query(..., ge=1),
    session: AsyncSession = Depends(get_session),
) -> PersonOut:
    user = await get_or_create_user(session, tg_id)
    result = await session.execute(select(Person).where(Person.id == person_id, Person.user_id == user.id))
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if "grid_id" in payload.__fields_set__:
        if payload.grid_id is None:
            person.grid_id = None
        else:
            grid_result = await session.execute(
                select(Grid).where(Grid.id == payload.grid_id, Grid.user_id == user.id)
            )
            if not grid_result.scalar_one_or_none():
                raise HTTPException(status_code=404, detail="Grid not found")
            person.grid_id = payload.grid_id

    if payload.full_name is not None:
        person.full_name = payload.full_name.strip()
    if payload.fields is not None:
        person.fields = payload.fields

    await session.commit()
    return PersonOut(
        id=person.id,
        full_name=person.full_name,
        fields=person.fields or {},
        grid_id=person.grid_id,
    )


@app.delete("/api/people/{person_id}")
async def delete_person(
    person_id: int,
    tg_id: int = Query(..., ge=1),
    session: AsyncSession = Depends(get_session),
) -> Dict[str, str]:
    user = await get_or_create_user(session, tg_id)
    result = await session.execute(select(Person).where(Person.id == person_id, Person.user_id == user.id))
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    await session.execute(
        delete(NodePosition).where(
            NodePosition.user_id == user.id,
            NodePosition.node_type == "person",
            NodePosition.node_id == person.id,
        )
    )
    await session.delete(person)
    await session.commit()
    return {"status": "deleted"}


router = Router()


@router.message(CommandStart())
async def start(message: Message) -> None:
    if not BOT_TOKEN:
        await message.answer("Bot is not configured. Set BOT_TOKEN in the environment.")
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Open Friends MiniApp", web_app=WebAppInfo(url=WEBAPP_URL))]
        ]
    )
    await message.answer(
        "Welcome! Tap the button below to open your Friends MiniApp.",
        reply_markup=keyboard,
        parse_mode=ParseMode.HTML,
    )


async def run_bot() -> None:
    if not BOT_TOKEN:
        logging.warning("BOT_TOKEN is not set. Bot polling is skipped.")
        while True:
            await asyncio.sleep(3600)

    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()
    dp.include_router(router)
    await dp.start_polling(bot)


async def run_web() -> None:
    import uvicorn

    config = uvicorn.Config(app, host=WEB_HOST, port=WEB_PORT, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


async def main() -> None:
    await init_db()
    await asyncio.gather(run_web(), run_bot())


if __name__ == "__main__":
    asyncio.run(main())
