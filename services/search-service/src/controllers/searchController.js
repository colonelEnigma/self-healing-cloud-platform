const { searchProducts } = require("../service/searchService");

const search = async (req, res) => {
  try {
    const { q, category, minPrice, maxPrice, page = 1, limit = 10 } = req.query;

    const results = await searchProducts({
      query: q,
      category,
      minPrice,
      maxPrice,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.json({
      page: parseInt(page),
      limit: parseInt(limit),
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { search };
