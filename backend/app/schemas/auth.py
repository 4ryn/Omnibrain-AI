import uuid

from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    name: str | None
    avatar_url: str | None


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    slug: str
    public_id: str
    plan: str


class MeOut(BaseModel):
    user: UserOut
    workspaces: list[WorkspaceOut]
    csrf_token: str
    role: str = "owner"
