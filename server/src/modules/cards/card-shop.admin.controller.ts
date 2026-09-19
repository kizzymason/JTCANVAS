import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminOnly, Audit, CurrentUser } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { CardShopAdminService } from "./card-shop.admin.service";
import { AdminCardOrderQueryDto, GenerateProductCardsDto, ImportProductCardsDto, SettleCardOrderDto, UpsertCardProductDto } from "./dto/card-shop.dto";

/** Card-shop administration. Every mutation is audited: these calls change what is on sale. */
@ApiTags("admin")
@AdminOnly()
@Controller("admin/card-shop")
export class CardShopAdminController {
    constructor(private readonly admin: CardShopAdminService) {}

    @Get("products")
    @ApiOperation({ summary: "卡密商品列表，含可售库存与已售数量" })
    listProducts() {
        return this.admin.listProducts();
    }

    @Post("products")
    @Audit({ action: "card_product.create", targetType: "card_product" })
    @ApiOperation({ summary: "新增卡密商品" })
    createProduct(@Body() body: UpsertCardProductDto) {
        return this.admin.createProduct(body);
    }

    @Patch("products/:id")
    @Audit({ action: "card_product.update", targetType: "card_product" })
    @ApiOperation({ summary: "修改卡密商品名称、价格或上下架" })
    updateProduct(@Param("id") id: string, @Body() body: UpsertCardProductDto) {
        return this.admin.updateProduct(id, body);
    }

    @Delete("products/:id")
    @Audit({ action: "card_product.delete", targetType: "card_product" })
    @ApiOperation({ summary: "删除卡密商品（已有订单或库存时拒绝）" })
    deleteProduct(@Param("id") id: string) {
        return this.admin.deleteProduct(id);
    }

    @Post("products/:id/generate")
    @Audit({ action: "card_product.generate", targetType: "card_product" })
    @ApiOperation({ summary: "为该商品生成一批新卡密" })
    generate(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: GenerateProductCardsDto) {
        return this.admin.generateCards(id, body, user.id);
    }

    @Post("products/:id/import")
    @Audit({ action: "card_product.import", targetType: "card_product" })
    @ApiOperation({ summary: "把已有卡密按分类导入该商品库存" })
    import(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: ImportProductCardsDto) {
        return this.admin.importCards(id, body, user.id);
    }

    @Get("orders")
    @ApiOperation({ summary: "卡密订单列表与销售汇总" })
    listOrders(@Query() query: AdminCardOrderQueryDto) {
        return this.admin.listOrders(query);
    }

    @Get("orders/:id/codes")
    @ApiOperation({ summary: "查看某订单已发放的卡密（用于客服核对）" })
    orderCodes(@Param("id") id: string) {
        return this.admin.orderCodes(id);
    }

    @Post("settle")
    @Audit({ action: "card_order.settle", targetType: "card_order" })
    @ApiOperation({ summary: "人工确认到账并发卡：网关通知丢失或线下收款时使用" })
    settle(@Body() body: SettleCardOrderDto) {
        return this.admin.settleOrder(body);
    }
}
