from sqlalchemy import create_engine, Column, Integer, String, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

import os

SQLALCHEMY_DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://neondb_owner:npg_vgp3dOrAhQb2@ep-solitary-bar-aqpuo32r.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require")

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)

    history = relationship("PlayHistory", back_populates="user")


class PlayHistory(Base):
    __tablename__ = "play_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    song_url = Column(String, index=True)
    song_title = Column(String)
    play_count = Column(Integer, default=1)

    user = relationship("User", back_populates="history")


# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
